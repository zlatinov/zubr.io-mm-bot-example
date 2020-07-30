const {
    EXIT_CODE_INSTRUMENT_NOT_READY,
    INSTRUMENT_STATUS_READY_TO_TRADE,
    ORDER_STATUS_NEW,
    ORDER_STATUS_PARTIALLY_FILLED,
    ORDER_STATUS_FILLED,
    ORDER_STATUS_CANCELLED,
    ORDER_SIDE_SELL,
    ORDER_SIDE_BUY,
    RPC_CHANNEL_ORDERBOOK,
    RPC_CHANNEL_POSITIONS
} = require('../constants.js');

const mathjs = require('mathjs')
const math = mathjs.create(mathjs.all);
math.config({ number: 'BigNumber' });

module.exports = function (logger, config, state, zubr) {

    /**
     * Make sure the instrument is tradable and save data for the instrument
     * Min increment is used when calculating the prices
     * Min and Max prices are used to initiate the book prices
     */
    function readInstruments(data) {
        if (data.tag === 'ok') {
            if (data.value && data.value[config['INSTRUMENT_ID']] && data.value[config['INSTRUMENT_ID']].status === INSTRUMENT_STATUS_READY_TO_TRADE) {
                const instrument = data.value[config['INSTRUMENT_ID']]

                state.exchange.minPriceIncrement = instrument.minPriceIncrement

                return
            }
        }

        //console.log('Instrument not ready for trading')
        process.exit(EXIT_CODE_INSTRUMENT_NOT_READY)
    }

    // Update current position size
    function readPositions(data) {
        if (data.value.payload) {
            const instrument = data.value.payload[config['INSTRUMENT_ID']] ? data.value.payload[config['INSTRUMENT_ID']] : data.value.payload

            if (data.value.payload[config['INSTRUMENT_ID']] || data.value.payload.instrumentId == config['INSTRUMENT_ID']) {
                state.exchange.positionSize = instrument.size

                logPositionChange()
            }
        }

        // Monitor the orderbook changes to add orders inbetween the spread
        zubr.subscribe(RPC_CHANNEL_ORDERBOOK, readNewQuotes)

        // We got the initial position and can unsubscribe now
        zubr.unsubscribe(RPC_CHANNEL_POSITIONS)
    }


    // Update local information about the orders
    function processOrderUpdate(order) {
        switch (order.status) {
            case ORDER_STATUS_NEW:
                addOrderToInternalList(order)
                break;
            case ORDER_STATUS_PARTIALLY_FILLED:
                updatePositionFromOrder(order)
                addOrderToInternalList(order)
                break;
            case ORDER_STATUS_FILLED:
                updatePositionFromOrder(order)
                removeOrderFromInternalList(order)
                break
            case ORDER_STATUS_CANCELLED:
                removeOrderFromInternalList(order)
                break
            default:
            //console.log('order', order)
        }
    }

    function removeOrderFromInternalList(order) {
        delete state.exchange.orders[order.id.toString()]

        logger.debug('order removed from internal list ' + order.id.toString())
    }

    function addOrderToInternalList(order) {
        state.exchange.orders[order.id.toString()] = order

        logger.debug('order added to internal list ' + order.id.toString())
    }

    function updatePositionFromOrder(order) {
        if (order.instrument != config['INSTRUMENT_ID'] || hasOrderBeenFullyProcessed(order)) {
            return
        }

        const alreadyFilled = state.exchange.processedOrders[order.id.toString()] ? state.exchange.processedOrders[order.id.toString()].processedSize : 0
        const size = (order.status === ORDER_STATUS_FILLED ? order.initialSize : order.initialSize - order.remainingSize) - alreadyFilled

        state.exchange.processedOrders[order.id.toString()] = {
            updateTime: order.updateTime,
            processedSize: size
        }

        if (order.side === ORDER_SIDE_BUY) {
            state.exchange.positionSize += size

            logPositionChange()

            return
        }

        state.exchange.positionSize -= size

        logPositionChange()

        // Clear the old processed orders once the list gets too big
        const processedOrdersKeys = Object.keys(state.exchange.processedOrders)
        if (processedOrdersKeys.length > 10000) {
            clearOldProcessedOrders(processedOrdersKeys)
        }
    }

    function logPositionChange() {
        logger.info('Position changed to ' + state.exchange.positionSize)
    }

    function hasOrderBeenFullyProcessed(order) {
        return state.exchange.processedOrders[order.id.toString()] && state.exchange.processedOrders[order.id.toString()].processedSize === order.initialSize
    }

    function clearOldProcessedOrders(processedOrdersKeys) {
        processedOrdersKeys.forEach(orderId => {
            if (Math.floor(Date.now() / 1000) - state.exchange.processedOrders[orderId].updateTime > 60 * 60) {
                delete state.exchange.processedOrders[orderId]
            }
        })

        logger.debug('Cleared old processed orders list')
    }

    // Orders update handler
    function readOrders(data) {
        /**
         * Ignore the first batch of orders which the server sends right after
         * we subscribe because they are old orders and we shouldn't change the
         * current position with info from them
         */
        if (!state.exchange.initOrders) {
            state.exchange.initOrders = true

            return
        }

        if (data.tag !== 'ok') {
            return
        }

        if (data.value.payload.id) {
            processOrderUpdate(data.value.payload)

            printInfo()

            return
        }

        const ordersKeys = Object.keys(data.value.payload)
        if (!ordersKeys.length) {
            return
        }

        ordersKeys.forEach(orderId => {
            processOrderUpdate(data.value.payload[orderId])
        });

        printInfo()
    }

    function printInfo() {
        if (Date.now() - state.lastPrintInfo < 500) {
            return
        }

        const keys = Object.keys(state.exchange.orders)
        if (keys.length == 0 || (keys.length < 2 && !isBullPositionMaxed() && !isBearPositionMaxed())) {
            return
        }

        state.lastPrintInfo = Date.now()

        console.clear()
        console.log('Current position: ' + state.exchange.positionSize)
        console.log('Active orders:')
        keys.forEach(orderId => {
            const order = state.exchange.orders[orderId]
            console.log(orderId + ' ' + order.side ? order.side + ' ' + order.initialSize + ' @ ' + math.multiply(math.bignumber(order.price.mantissa), math.bignumber(math.pow(10, order.price.exponent))) : '')
        });
    }

    // Update local book with info from the server's orderbook
    function updateBook(newBook) {
        if (!state.book[config['INSTRUMENT_ID']]) {
            state.book[config['INSTRUMENT_ID']] = {
                id: config['INSTRUMENT_ID'],
                bid: 0,
                ask: 0
            }
        }

        if (newBook.bids.length) {
            state.book[config['INSTRUMENT_ID']].bid = newBook.bids[0].price
        }
        if (newBook.asks.length) {
            state.book[config['INSTRUMENT_ID']].ask = newBook.asks[0].price
        }

        logger.debug('Internal book updated: ' + JSON.stringify(state.book))
    }

    function isBullPositionMaxed() {
        return state.exchange.positionSize >= config['MAX_POSITION']
    }

    function isBearPositionMaxed() {
        return state.exchange.positionSize <= -config['MAX_POSITION']
    }

    // Read new quotes from the orderbook and put orders inbetween the spread
    function readNewQuotes(data) {
        if (data.value[config['INSTRUMENT_ID']]) {
            updateBook(data.value[config['INSTRUMENT_ID']])
        }

        /**
         * Wait for all orders to be cancelled and open new ones or
         * open new ones straight away if there are no orders to cancel
         */
        const cancellationPromise = cancelAllOrders()
        if (cancellationPromise) {
            cancellationPromise.then(createSpreadOrders)
        } else {
            createSpreadOrders()
        }
    }

    function placeOrder(price, side) {
        if (state.stopTrading) {
            return
        }

        let size = config['QUOTE_SIZE']

        if (side === ORDER_SIDE_BUY && state.exchange.positionSize + config['QUOTE_SIZE'] > config['MAX_POSITION']) {
            size = config['MAX_POSITION'] - state.exchange.positionSize
        }

        if (side === ORDER_SIDE_SELL && state.exchange.positionSize - config['QUOTE_SIZE'] < -config['MAX_POSITION']) {
            size = config['MAX_POSITION'] + state.exchange.positionSize
        }

        zubr.placeNewOrder(config['INSTRUMENT_ID'], price, size, config['ORDER_TYPE'], config['ORDER_TIME_IN_FORCE'], side, function (data) {
            if (data.tag === 'ok') {
                logger.info(side + ' ORDER OPENED: ' + data.value + ' ' + size + ' @ ' + math.multiply(math.bignumber(price.mantissa), math.bignumber(math.pow(10, price.exponent))))
            }
            if (data.tag === 'err') {
                logger.info('ERROR OPENING ORDER: ' + data.value.code)
            }

            // Allow sending of new orders
            state.exchange.ordersSent = false
        })
    }

    /**
     * Returns a promiss which is resolved once all orders are cancelled
     * or undefined if there are no orders to cancel
     */
    function cancelAllOrders() {
        const keys = Object.keys(state.exchange.orders)

        if (!keys.length) {
            return
        }

        let promises = []

        keys.forEach(orderId => {
            promises.push(new Promise(function (resolve, reject) {
                zubr.cancelOrder(orderId, function (data) {
                    if (data.result && data.result.order_id) {
                        logger.info('ORDER CANCELLED: ' + data.result.order_id)
                    }

                    resolve()
                })
            }))

            removeOrderFromInternalList({ id: orderId })
        });

        return Promise.all(promises)
    }

    function createSpreadOrders() {
        // Don't send new orders while the previous are being processed
        if (state.exchange.ordersSent) {
            return
        }

        const spread = getSpread()
        if (spread) {
            if (isBullPositionMaxed()) {
                logger.info('Bull position at max, only selling now.')
                placeOrder(spread.sell, ORDER_SIDE_SELL)
            } else if (isBearPositionMaxed()) {
                logger.info('Bear position at max, only buying now.')
                placeOrder(spread.buy, ORDER_SIDE_BUY)
            } else {
                placeOrder(spread.buy, ORDER_SIDE_BUY)
                placeOrder(spread.sell, ORDER_SIDE_SELL)
            }

            // Don't send new orders while the previous are being processed
            state.exchange.ordersSent = true
        }
    }

    function getSpread() {
        const book = state.book[config['INSTRUMENT_ID']]

        if (!book || !book.ask || !book.bid) {
            return null
        }

        // Calculate the middle of the spread and
        function getMidOfSpread() {
            return roundPricePerMinIncrement(
                math.divide(math.add(math.bignumber(book.ask.mantissa), math.bignumber(book.bid.mantissa)), 2)
            )
        }

        // Make sure the price is valid considering the minimum increment for the instrument
        function roundPricePerMinIncrement(price) {
            const minPriceIncrementMantissa = math.bignumber(state.exchange.minPriceIncrement.mantissa)

            return +math.multiply(math.round(math.divide(price, minPriceIncrementMantissa)), minPriceIncrementMantissa)
        }

        const mid = book.ask.exponent === book.bid.exponent ?
            {
                mantissa: getMidOfSpread(),
                exponent: book.ask.exponent
            } :
            {
                // TODO:
                mantissa: 1,
                exponent: 1
            }

        function getAsFloat(num) {
            return math.multiply(math.bignumber(num.mantissa), math.bignumber(math.pow(10, num.exponent)))
        }

        logger.debug('bid: ' + getAsFloat(book.bid) + ' mid: ' + getAsFloat(mid) + ' ask: ' + getAsFloat(book.ask) + ' interest: ' + config['INTEREST'] + ' shift*position: ' + config['SHIFT'] * state.exchange.positionSize + ' change: ' + getAsFloat({
            mantissa: checkChangeValue(asMantissa(config['INTEREST']) - asMantissa(config['SHIFT'] * state.exchange.positionSize)),
            exponent: book.ask.exponent
        }))

        // Change config input to mantissa format
        function asMantissa(num) {
            return +math.multiply(math.bignumber(num), math.bignumber(math.pow(10, -book.ask.exponent)))
        }

        // Make sure the new price will be valid considering the minimum increment for the instrument
        function checkChangeValue(num) {
            if (!state.exchange.minPriceIncrement) {
                return num
            }

            if (num < state.exchange.minPriceIncrement.mantissa) {
                return state.exchange.minPriceIncrement.mantissa
            }

            return num
        }

        return {
            ask: book.ask,
            bid: book.bid,
            buy: {
                mantissa: mid.mantissa - checkChangeValue(asMantissa(config['INTEREST']) - asMantissa(config['SHIFT'] * state.exchange.positionSize)),
                exponent: book.ask.exponent
            },
            sell: {
                mantissa: mid.mantissa + checkChangeValue(asMantissa(config['INTEREST']) - asMantissa(config['SHIFT'] * state.exchange.positionSize)),
                exponent: book.ask.exponent
            }
        }
    }

    return {
        readInstruments,
        readPositions,
        readOrders,
        readNewQuotes,
        cancelAllOrders
    }
}