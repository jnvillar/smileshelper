const {TwitterApi, ApiResponseError} = require("twitter-api-v2");

const dotenv = require("dotenv");
dotenv.config();

const maxResults = process.env.MAX_RESULTS || 10;

const smiles = {
    authorizationToken: [
        'LjjYgOEj6ICHr5pA1qnCXZLQh70qr6uso05OY63XZ7iHGkwhwXj5TE',
    ],
    apiKey: 'aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw',
    milePrice: process.env.SMILES_MILE_PRICE,
};

const responseTweetUrl = process.env.RESPONSE_TWEET_URL;

const twitterClient = process.env.TWITTER_API_KEY && new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_KEY_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
}).v2;

const telegramApiToken = process.env.TELEGRAM_API_TOKEN
const telegramApiTokenLocal = process.env.TELEGRAM_API_TOKEN_LOCAL

module.exports = {
    maxResults,
    smiles,
    responseTweetUrl,
    twitterClient,
    telegramApiToken,
    telegramApiTokenLocal,
    ApiResponseError
};
