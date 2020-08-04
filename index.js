const WebSocket = require('ws')
const fs = require('fs').promises

const {
    CONFIG_FILENAME,
    EXIT_CODE_AUTH_FAILED,
    WS_URL_TESTNET,
    WS_ORIGIN_TESTNET,
    WS_URL_LIVE,
    WS_ORIGIN_LIVE,
    WS_USER_AGENT,
    RPC_CHANNEL_POSITIONS,
    RPC_CHANNEL_INSTRUMENTS
} = require('./constants.js');

var ws
var config = {}
var state = {
    rpcIds: {},
    rpcHandlers: {},
    book: {},
    exchange: {
        minPriceIncrement: 0,
        positionSize: 0,
        positionSizeExchange: 0,
        initOrders: false,
        initBook: false,
        processedOrders: {},
        orders: {},
        ordersSent: false,
        readPositionInit: false,
    },
    lastPrintInfo: 0,
    stopTrading: true
}

async function loadConfig() {
    return JSON.parse(await fs.readFile(CONFIG_FILENAME))
}

function getWebSocketClient() {
    const wsUrl = config['IS_TESTNET'] ? WS_URL_TESTNET : WS_URL_LIVE
    const wsOrigin = config['IS_TESTNET'] ? WS_ORIGIN_TESTNET : WS_ORIGIN_LIVE

    return new WebSocket(wsUrl, {
        origin: wsOrigin,
        headers: {
            'User-Agent': WS_USER_AGENT
        },
        ecdhCurve: 'auto'
    })
}

async function main() {
    // Load configuration
    config = await loadConfig()
    // Initiate WebSocket connection
    ws = getWebSocketClient()

    // Load logger
    const logger = require('./lib/logger')(config['LOGGER_LEVEL'])
    // Load module for interaction with Zubr WS API
    const zubr = require('./lib/zubr')(logger, config, state, ws)
    // Load module for MM bot logic
    const bot = require('./lib/bot')(logger, config, state, zubr)

    ws.on('error', function (err) {
        logger.error(err.name + ' ' + err.message)
    })
    ws.on('close', function (code, reason) {
        logger.error(code + ' ' + reason)
    })

    // Make sure to keep the connection alive with ping/pong messages
    ws.on('pong', function () {
        setTimeout(function () {
            ws.ping()
        }, 15000)
    })

    // Handler for connection open event
    ws.on('open', function open() {
        logger.info('Connected to server')

        // Authorize after connection
        zubr.auth(function (data) {
            // If the authorization is successful, subscribe for all related channels
            if (data.tag === 'ok') {
                logger.info('Authorized successfully')

                /**
                 * Get the initial position from the exchange or from the config, based on settings
                 * To properly boot the bot we load in order:
                 * 1. The current position
                 * 2. Instrument info
                 * 3. Orders channel
                 * 4. Orderbook channel
                 */
                if (!config['READ_INITIAL_POSITION_FROM_EXCHANGE']) {
                    state.exchange.positionSize = config['INITIAL_POSITION']

                    zubr.subscribe(RPC_CHANNEL_INSTRUMENTS, bot.readInstruments)
                }
                else {
                    zubr.subscribe(RPC_CHANNEL_POSITIONS, bot.readPositions)
                }

                initExitHandlers(logger, bot)

                return
            }

            logger.error('Authorization failure')
            process.exit(EXIT_CODE_AUTH_FAILED)
        })

        ws.ping()
    })

    /**
     * Handler for WebSocket messages
     * We add an ID to every METHOD request we send to the server and optionally a handler function.
     * The response from the server to our request includes this ID, so we can match the response with the request.
     * When a response is received, the handler function from the request is called with data from the response.
     * The CHANNEL requests have a handler function which is called every time the server pushes new data to the channel.
     */
    ws.on('message', function incoming(data) {
        logger.debug(data)

        const json = JSON.parse(data)

        // We need to make sure we clear the already used IDs
        delete state.rpcIds[json.id]

        if (state.rpcHandlers[json.id]) {
            state.rpcHandlers[json.id](json.result)

            // We need to make sure we clear the already executed handlers
            delete state.rpcHandlers[json.id]

            return
        }

        if (json.result.channel) {
            if (state.rpcHandlers[json.result.channel]) {
                state.rpcHandlers[json.result.channel](json.result.data)
            }

            return
        }
    })
}

// On bot exit stop sending new orders and cancel all open order
function initExitHandlers(logger, bot) {
    function exitHandler(signal, code) {
        if (code == 'uncaughtException') {
            console.log(signal)

            logger.error(signal)
        }

        state.stopTrading = true

        const cancellationPromise = bot.cancelAllOrders()
        if (cancellationPromise) {
            cancellationPromise.then(function () {
                process.exit(code)
            })
        } else {
            process.exit(code)
        }
    }

    // Catches ctrl+c event
    process.on('SIGINT', exitHandler);

    // Catches "kill pid"
    process.on('SIGUSR1', exitHandler);
    process.on('SIGUSR2', exitHandler);

    // Catches uncaught exceptions
    process.on('uncaughtException', exitHandler);
}

main()
