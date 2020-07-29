# Zubr MM Bot

Uses [Zubr WebSocket API](https://spec.zubr.io/#websocket-api) for market making. Reads order book in real-time and place orders between the best bid and ask.

## Install

 `npm install`

## Config

After installation, you need to update the settings in `config.json`. Add your API credentials, change the instrument and the orders settings as per your needs.

* IS_TESTNET - `true` for test environment and `false` for production.
* CLIENT_KEY - Your API key.
* CLIENT_SECRET - Your API secret.
* INSTRUMENT_ID - Instrument ID. BTCUSD - `1`, ETHUSD - `2`, ETHBTC - `3`
* ORDER_TYPE - `POST_ONLY` or `LIMIT`
* ORDER_TIME_IN_FORCE": `GTC`, `IOC`, `FOK`
* QUOTE_SIZE - The size of each order.
* INTEREST - Interest size. Check formula for more information.
* SHIFT - Interest size. Check formula for more information.
* MAX_POSITION - Maximum position size.
* INITIAL_POSITION - Initial position size. It's used only when `READ_INITIAL_POSITION_FROM_EXCHANGE` is set to `false`
* READ_INITIAL_POSITION_FROM_EXCHANGE - `true` to read the initial position from the exchange or `false` to read it from `INITIAL_POSITION` config.
* LOGGER_LEVEL - Logging level - `error`, `info`, `debug`. Log files can be found in `logs` folder.

Prices for orders are calculated:

* BUY (current best purchase price + current best sale price) / 2 - interest - shift * position
* SELL (current best purchase price + current best sale price) / 2 + interest - shift * position

## Run

 `npm run start`
