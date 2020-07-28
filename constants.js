const CONFIG_FILENAME = 'config.json'
const LOG_FILENAMES = {
    1: 'logs/error.log',
    2: 'logs/info.log',
    3: 'logs/debug.log'
}
const LOG_LEVELS = {
    'error': 1,
    'info': 2,
    'debug': 3
}
const LOG_LEVEL_INFO = 'info'
const LOG_LEVEL_ERROR = 'error'
const LOG_LEVEL_DEBUG = 'debug'
const EXIT_CODE_AUTH_FAILED = 1
const EXIT_CODE_INSTRUMENT_NOT_READY = 2
const WS_URL_TESTNET = 'wss://uat.zubr.io/api/v1/ws'
const WS_ORIGIN_TESTNET = 'https://uat.zubr.io'
const WS_URL_LIVE = 'wss://zubr.io/api/v1/ws'
const WS_ORIGIN_LIVE = 'https://zubr.io'
const WS_USER_AGENT = 'Node.JS MM Bot Example'
const RPC_METHOD_CHANNEL_SUBSCRIBE = 1
const RPC_METHOD_CHANNEL_UNSUBSCRIBE = 2
const RPC_METHOD_METHOD = 9
const RPC_CHANNEL_INSTRUMENTS = 'instruments'
const RPC_CHANNEL_ORDERBOOK = 'orderbook'
const RPC_CHANNEL_ORDERS = 'orders'
const RPC_CHANNEL_POSITIONS = 'positions'
const INSTRUMENT_STATUS_READY_TO_TRADE = 'READY_TO_TRADE'
const ORDER_STATUS_NEW = 'NEW'
const ORDER_STATUS_FILLED = 'FILLED'
const ORDER_STATUS_CANCELLED = 'CANCELLED'
const ORDER_STATUS_PARTIALLY_FILLED = 'PARTIALLY_FILLED'
const ORDER_SIDE_BUY = 'BUY'
const ORDER_SIDE_SELL = 'SELL'
const ORDER_TYPE_LIMIT = 'LIMIT'
const ORDER_TYPE_POST = 'POST_ONLY'
const ORDER_TIME_IN_FORCE_GTC = 'GTC' // good 'til cancelled order, active while not cancelled or executed
const ORDER_TIME_IN_FORCE_IOC = 'IOC' // immediate or cancel order, unfilled part or order immediately canceled
const ORDER_TIME_IN_FORCE_FOK = 'FOK' // fill or kill order, complete execution or nothing

module.exports = {
    CONFIG_FILENAME,
    LOG_FILENAMES,
    LOG_LEVELS,
    LOG_LEVEL_INFO,
    LOG_LEVEL_ERROR,
    LOG_LEVEL_DEBUG,
    EXIT_CODE_AUTH_FAILED,
    EXIT_CODE_INSTRUMENT_NOT_READY,
    WS_URL_TESTNET,
    WS_ORIGIN_TESTNET,
    WS_URL_LIVE,
    WS_ORIGIN_LIVE,
    WS_USER_AGENT,
    INSTRUMENT_STATUS_READY_TO_TRADE,
    ORDER_STATUS_NEW,
    ORDER_STATUS_FILLED,
    ORDER_STATUS_CANCELLED,
    ORDER_STATUS_PARTIALLY_FILLED,
    ORDER_SIDE_BUY,
    ORDER_SIDE_SELL,
    ORDER_TYPE_LIMIT,
    ORDER_TYPE_POST,
    ORDER_TIME_IN_FORCE_GTC,
    ORDER_TIME_IN_FORCE_IOC,
    ORDER_TIME_IN_FORCE_FOK,
    RPC_METHOD_CHANNEL_SUBSCRIBE,
    RPC_METHOD_CHANNEL_UNSUBSCRIBE,
    RPC_METHOD_METHOD,
    RPC_CHANNEL_INSTRUMENTS,
    RPC_CHANNEL_ORDERBOOK,
    RPC_CHANNEL_ORDERS,
    RPC_CHANNEL_POSITIONS
}