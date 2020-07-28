const {
    RPC_METHOD_METHOD,
    RPC_METHOD_CHANNEL_SUBSCRIBE,
    RPC_METHOD_CHANNEL_UNSUBSCRIBE
} = require('../constants.js');

module.exports = function (logger, config, state, ws) {

    // Simple way to get unique id for our RPC requests
    function getUid() {
        const id = Math.round(Math.random() * 10000)

        if (state.rpcIds[id]) {
            return getUid()
        }

        state.rpcIds[id] = id

        return id
    }

    // https://spec.zubr.io/#websocket-api
    function getRpcMsg(method, params) {
        return {
            'method': method,
            'params': params,
            'id': getUid()
        }
    }

    function rpcSendCmd(rpcMsg, handler) {
        const txt = JSON.stringify(rpcMsg)

        logger.debug(txt)

        if (handler) {
            state.rpcHandlers[rpcMsg.id] = handler
        }

        ws.send(txt);
    }

    function getRpcMsgMethod(params) {
        return getRpcMsg(RPC_METHOD_METHOD, {
            'data': params
        })
    }

    function getRpcMsgChannelSubscribe(channel) {
        return getRpcMsg(RPC_METHOD_CHANNEL_SUBSCRIBE, {
            'channel': channel
        })
    }

    function getRpcMsgChannelUnsubscribe(channel) {
        return getRpcMsg(RPC_METHOD_CHANNEL_UNSUBSCRIBE, {
            'channel': channel
        })
    }

    /**
     * Authentication signature
     * https://spec.zubr.io/#websocket-authentification
     */
    function getAuthSignature() {
        const crypto = require("crypto")

        const timestamp = Math.floor(Date.now() / 1000)
        const query = Buffer.from('key=' + config['CLIENT_KEY'] + ';time=' + timestamp.toString()).toString('utf8')
        const signature = crypto.createHmac("sha256", Buffer.from(config['CLIENT_SECRET'], 'hex')).update(query).digest('hex');

        return {
            timestamp,
            signature
        }
    }

    /**
     * Authorization
     * https://spec.zubr.io/#websocket-authentification
     */
    function auth(handler) {
        const auth = getAuthSignature()

        rpcSendCmd(
            getRpcMsgMethod({
                'method': "loginSessionByApiToken",
                'params': {
                    'apiKey': config['CLIENT_KEY'],
                    'time': {
                        'seconds': auth.timestamp,
                        'nanos': 0
                    },
                    'hmacDigest': auth.signature
                }
            }),
            handler
        )
    }

    // https://spec.zubr.io/#websocket-subscriptions
    function subscribe(channel, handler) {
        rpcSendCmd(
            getRpcMsgChannelSubscribe(channel),
            function () {
                state.rpcHandlers[channel] = handler
            }
        )
    }

    // https://spec.zubr.io/#websocket-subscriptions
    function unsubscribe(channel, handler) {
        const unsubHandler = handler ? function () {
            state.rpcHandlers[channel] = handler
        } : undefined

        rpcSendCmd(
            getRpcMsgChannelUnsubscribe(channel),
            unsubHandler
        )
    }

    // https://spec.zubr.io/#place-new-order
    function placeNewOrder(instrument, price, size, type, timeInForce, side, handler) {
        rpcSendCmd(
            getRpcMsgMethod({
                'method': "placeOrder",
                'params': {
                    "instrument": instrument,
                    "price": price,
                    "size": size,
                    "type": type,
                    "timeInForce": timeInForce,
                    "side": side
                }
            }),
            handler
        )
    }

    // https://spec.zubr.io/#cancel-order
    function cancelOrder(orderId, handler) {
        rpcSendCmd(
            getRpcMsgMethod({
                'method': "cancelOrder",
                'params': orderId
            }),
            handler
        )
    }

    return {
        auth,
        subscribe,
        unsubscribe,
        placeNewOrder,
        cancelOrder
    }
}