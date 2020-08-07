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
    RPC_CHANNEL_INSTRUMENTS,
    RPC_CHANNEL_POSITIONS,
    RPC_CHANNEL_ORDERS
} = require('../constants.js');

const mathjs = require('mathjs')
const math = mathjs.create(mathjs.all);
math.config({ number: 'BigNumber' });

module.exports = function (logger, config, state, zubr) {

    /**
     * Make sure the instrument is tradable and save data for the instrument
     * Min increment is used when calculating the prices
     */
    function readInstruments(data) {
        if (data.tag === 'ok') {
            if (data.value && data.value[config['INSTRUMENT_ID']] && data.value[config['INSTRUMENT_ID']].status === INSTRUMENT_STATUS_READY_TO_TRADE) {
                const instrument = data.value[config['INSTRUMENT_ID']]

                state.exchange.minPriceIncrement = instrument.minPriceIncrement

                if (state.exchange.initInstrument === false) {
                    // Monitor the orders changes
                    zubr.subscribe(RPC_CHANNEL_ORDERS, readOrders)

                    state.exchange.initInstrument = true
                }

                return
            }
        }

        logger.error('Instrument not ready for trading')
        exit(EXIT_CODE_INSTRUMENT_NOT_READY)
    }

    // Update current position size
    function readPositions(data) {
        if (data.value.payload) {
            const instrument = data.value.payload[config['INSTRUMENT_ID']] ? data.value.payload[config['INSTRUMENT_ID']] : data.value.payload

            if (data.value.payload[config['INSTRUMENT_ID']] || data.value.payload.instrumentId == config['INSTRUMENT_ID']) {
                if (state.exchange.readPositionInit == false && config['READ_INITIAL_POSITION_FROM_EXCHANGE']) {
                    state.exchange.positionSize = instrument.size
                }
            }
        }

        if (state.exchange.readPositionInit == false) {
            // Read instrument information which will be used by the bot
            zubr.subscribe(RPC_CHANNEL_INSTRUMENTS, readInstruments)

            state.exchange.readPositionInit = true
        }

        // We got the initial position and can unsubscribe now
        zubr.unsubscribe(RPC_CHANNEL_POSITIONS)
    }


    // Update local information about the orders
    function processOrderUpdate(order) {
        if (order.updateTime.seconds < state.startTime) {
            return
        }

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
                logger.debug('Unhandled order status: ' + JSON.stringify(order))
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

        // Allow placing of orders for the same quotes if our orders have been filled
        state.placeNewOrders = true

        const alreadyFilled = state.exchange.processedOrders[order.id.toString()] ? state.exchange.processedOrders[order.id.toString()].processedSize : 0
        const size = (order.status === ORDER_STATUS_FILLED ? order.initialSize : order.initialSize - order.remainingSize) - alreadyFilled

        state.exchange.processedOrders[order.id.toString()] = {
            updateTime: order.updateTime.seconds,
            processedSize: alreadyFilled + size
        }

        if (order.side === ORDER_SIDE_BUY) {
            state.exchange.positionSize += size

            logPositionChange(order)

            return
        }

        state.exchange.positionSize -= size

        logPositionChange(order)

        // Clear the old processed orders once the list gets too big
        const processedOrdersKeys = Object.keys(state.exchange.processedOrders)
        if (processedOrdersKeys.length > 10000) {
            clearOldProcessedOrders(processedOrdersKeys)
        }
    }

    function logPositionChange(order) {
        logger.info(order.id + ' order changed position to: ' + state.exchange.positionSize)
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
            // Monitor the orderbook changes to add orders inbetween the spread
            zubr.subscribe(RPC_CHANNEL_ORDERBOOK, readNewQuotes)

            state.exchange.initOrders = true
            state.stopTrading = false

            return
        }

        if (data.tag !== 'ok') {
            return
        }

        if (data.value.payload.id) {
            processOrderUpdate(data.value.payload)

            return
        }

        const ordersKeys = Object.keys(data.value.payload)
        if (!ordersKeys.length) {
            return
        }

        ordersKeys.forEach(orderId => {
            processOrderUpdate(data.value.payload[orderId])
        });
    }

    function printInfo() {
        console.clear()
        console.log(new Date().toISOString())
        console.log('Current position: ' + state.exchange.positionSize)
        if (state.exchange.bestAsk) {
            console.log('Best Ask: ' + getPriceAsFloat(state.exchange.bestAsk))
        }
        if (state.exchange.bestBid) {
            console.log('Best Bid: ' + getPriceAsFloat(state.exchange.bestBid))
        }
        console.log('Active orders:')
        Object.keys(state.exchange.orders).forEach(orderId => {
            const order = state.exchange.orders[orderId]
            if (order.side) {
                console.log(orderId + ' ' + order.side + ' ' + order.initialSize + ' @ ' + getPriceAsFloat(order.price))
            }
        });
    }

    // Update local book with info from the server's orderbook
    function updateBook(newBook, side) {
        newBook.forEach(function (quote) {
            if (quote.size) {
                side[quote.price.mantissa] = quote
            } else {
                delete side[quote.price.mantissa]
            }
        })

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
        if (!data.value[config['INSTRUMENT_ID']]) {
            return
        }

        if (data.value[config['INSTRUMENT_ID']].bids.length) {
            updateBook(data.value[config['INSTRUMENT_ID']].bids, state.book.bids)
            updateBestQuote('bestBid', state.book.bids, Math.max)
        }

        if (data.value[config['INSTRUMENT_ID']].asks.length) {
            updateBook(data.value[config['INSTRUMENT_ID']].asks, state.book.asks)
            updateBestQuote('bestAsk', state.book.asks, Math.min)
        }

        if (state.exchange.bestBid.mantissa > state.exchange.bestAsk.mantissa) {
            state.placeNewOrders = false
            state.exchange.bestBid = false
            state.exchange.bestAsk = false
            state.book.bids = {}
            state.book.asks = {}
        }

        if (shouldNotPlaceNewOrders()) {
            return
        }

        /**
         * Wait for all orders to be cancelled and open new ones or
         * open new ones straight away if there are no orders to cancel
         */
        const cancellation = cancelAllOrders()
        if (cancellation) {
            cancellation.then(createSpreadOrders)
        } else {
            createSpreadOrders()
        }
    }

    function updateBestQuote(bestQuoteKey, quotes, func) {
        const keys = Object.keys(quotes)
        if (!keys.length) {
            return
        }

        const best = quotes[func.apply(null, keys.map(function (v) { return +v }))].price

        if (!state.exchange[bestQuoteKey] || state.exchange[bestQuoteKey].mantissa !== best.mantissa) {
            state.exchange[bestQuoteKey] = best ? best : false
            state.placeNewOrders = true
        }
    }

    function placeOrder(price, side) {
        let size = config['QUOTE_SIZE']

        if (side === ORDER_SIDE_BUY && state.exchange.positionSize + config['QUOTE_SIZE'] > config['MAX_POSITION']) {
            size = config['MAX_POSITION'] - state.exchange.positionSize
        }

        if (side === ORDER_SIDE_SELL && state.exchange.positionSize - config['QUOTE_SIZE'] < -config['MAX_POSITION']) {
            size = config['MAX_POSITION'] + state.exchange.positionSize
        }

        return new Promise(function (resolve, reject) {
            zubr.placeNewOrder(config['INSTRUMENT_ID'], price, size, config['ORDER_TYPE'], config['ORDER_TIME_IN_FORCE'], side, function (data) {
                if (data.tag === 'ok') {
                    logger.info('ORDER OPENED: ' + data.value)

                    resolve(data)
                }
                if (data.tag === 'err') {
                    logger.info('ERROR OPENING ORDER: ' + data.value.code)

                    reject(data)
                }
            })
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

        state.waitingForOrdersUpdates = true

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

        return Promise.all(promises).then(function () {
            state.waitingForOrdersUpdates = false
        })
    }

    function shouldNotPlaceNewOrders() {
        return state.stopTrading || state.waitingForOrdersUpdates || state.placeNewOrders === false
    }

    function createSpreadOrders() {
        if (Object.keys(state.exchange.orders).length >= 2) {
            return
        }

        const spread = getSpread()
        if (!spread) {
            return
        }

        // Don't send new orders while the previous are being processed
        state.waitingForOrdersUpdates = true

        let promisses = []
        let shouldBuy = false
        let shouldSell = false

        if (isBullPositionMaxed()) {
            logger.info('Bull position at max, only selling now.')
            shouldSell = true
        } else if (isBearPositionMaxed()) {
            logger.info('Bear position at max, only buying now.')
            shouldBuy = true
        } else {
            shouldBuy = true
            shouldSell = true
        }

        if (shouldBuy) {
            let buy = placeOrder(spread.buy, ORDER_SIDE_BUY)
            if (buy) {
                promisses.push(buy)
            }
        }
        if (shouldSell) {
            let sell = placeOrder(spread.sell, ORDER_SIDE_SELL)
            if (sell) {
                promisses.push(sell)
            }
        }

        if (!shouldBuy && !shouldSell) {
            state.waitingForOrdersUpdates = false
            state.placeNewOrders = false

            return
        }

        state.exchange.lastOrdersPromise = Promise.allSettled(promisses)

        state.exchange.lastOrdersPromise.then(function () {
            state.waitingForOrdersUpdates = false
            state.placeNewOrders = false
        })
    }

    function getSpread() {
        if (!state.exchange.bestBid || !state.exchange.bestAsk) {
            return null
        }

        // Calculate the middle of the spread and
        function getMidOfSpread() {
            return roundPricePerMinIncrement(
                math.divide(math.add(math.bignumber(state.exchange.bestAsk.mantissa), math.bignumber(state.exchange.bestBid.mantissa)), 2)
            )
        }

        // Make sure the price is valid considering the minimum increment for the instrument
        function roundPricePerMinIncrement(price) {
            const minPriceIncrementMantissa = math.bignumber(state.exchange.minPriceIncrement.mantissa)

            return +math.multiply(math.round(math.divide(price, minPriceIncrementMantissa)), minPriceIncrementMantissa)
        }

        const mid = state.exchange.bestAsk.exponent === state.exchange.bestBid.exponent ?
            {
                mantissa: getMidOfSpread(),
                exponent: state.exchange.bestAsk.exponent
            } :
            {
                // TODO:
                mantissa: 1,
                exponent: 1
            }

        logger.debug('bid: ' + getPriceAsFloat(state.exchange.bestBid) + ' mid: ' + getPriceAsFloat(mid) + ' ask: ' + getPriceAsFloat(state.exchange.bestAsk) + ' interest: ' + config['INTEREST'] + ' shift*position: ' + config['SHIFT'] * state.exchange.positionSize + ' change: ' + getPriceAsFloat({
            mantissa: checkChangeValue(asMantissa(config['INTEREST']) - asMantissa(config['SHIFT'] * state.exchange.positionSize)),
            exponent: state.exchange.bestAsk.exponent
        }))

        // Change config input to mantissa format
        function asMantissa(num) {
            return math.multiply(math.bignumber(num), math.bignumber(math.pow(10, -state.exchange.bestAsk.exponent)))
        }

        // Make sure the new price will be valid considering the minimum increment for the instrument
        function checkChangeValue(num) {
            if (!num) {
                return 0
            }

            if (!state.exchange.minPriceIncrement) {
                return num
            }

            if (Math.abs(num) < state.exchange.minPriceIncrement.mantissa) {
                return math.multiply(num < 0 ? -1 : 1, math.bignumber(state.exchange.minPriceIncrement.mantissa))
            }

            return num
        }

        const shift = asMantissa(math.multiply(math.bignumber(config['SHIFT']), math.bignumber(state.exchange.positionSize)))
        const changeBid = checkChangeValue(math.subtract(-asMantissa(config['INTEREST']), shift))
        const changeAsk = checkChangeValue(math.subtract(asMantissa(config['INTEREST']), shift))
        const spread = {
            ask: state.exchange.bestAsk,
            bid: state.exchange.bestBid,
            buy: {
                mantissa: roundPricePerMinIncrement(math.add(mid.mantissa, changeBid)),
                exponent: state.exchange.bestAsk.exponent
            },
            sell: {
                mantissa: roundPricePerMinIncrement(math.add(mid.mantissa, changeAsk)),
                exponent: state.exchange.bestAsk.exponent
            }
        }

        if (math.compare(math.subtract(math.multiply(asMantissa(config['INTEREST']), 2), math.subtract(spread.sell.mantissa, spread.buy.mantissa)), state.exchange.minPriceIncrement.mantissa) === 1) {
            return null
        }

        return spread
    }

    function getPriceAsFloat(num) {
        return math.multiply(math.bignumber(num.mantissa), math.bignumber(math.pow(10, num.exponent)))
    }

    function exit(code) {
        state.stopTrading = true

        if (!state.exchange.lastOrdersPromise) {
            process.exit(code)
        }

        state.exchange.lastOrdersPromise.then(function () {
            const cancellationPromise = cancelAllOrders()

            if (cancellationPromise) {
                cancellationPromise.then(function () {
                    process.exit(code)
                })
            } else {
                process.exit(code)
            }
        })
    }

    return {
        readInstruments,
        readPositions,
        readOrders,
        readNewQuotes,
        cancelAllOrders,
        printInfo,
        exit
    }
}