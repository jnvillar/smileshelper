const {monthSections, searching} = require("../config/constants");
const {buildError} = require("../utils/error");
const {padMonth} = require("../utils/string");
const {searchCityQuery, searchRegionalQuery} = require("./search");
const emoji = require("node-emoji");
const {findAlert, updateAlert} = require("./preferences");

const sendMessageInChunks = async (search, bot, chatId, response, inlineKeyboardMonths) => {
    if (!response) return;

    const maxResultsPerMessage = 35;
    const lines = response.split("\n");

    if (lines.length === 1) {
        lines[0] = `❌ ${search[0]}: ${lines[0]}`;
    }

    if (lines.length > 1) {
        lines[0] = `✅ La búsqueda: *${search[0]}* tuvo ${lines.length - 2} resultados`;
    }

    let results = [];
    for (let i = 0; i < lines.length; i++) {
        results.push(lines[i]);
        if (results.length === maxResultsPerMessage || i === lines.length - 1) {
            const options = {
                parse_mode: "Markdown",
                reply_markup: i === lines.length - 1 ? {inline_keyboard: inlineKeyboardMonths} : undefined,
            };
            await bot.sendMessage(chatId, results.join("\n"), options);
            results = [];
        }
    }
};

const searchMultipleDestination = async (match, msg, bot, fixedDay, isMultipleOrigin, send_message = true, alert = null) => {
    console.log(`${new Date().toLocaleTimeString()} ${alert ? "alert" : ""} ${msg.chat.username} ${match[0]}`);
    const chatId = msg.chat.id;
    if (send_message) {
        bot.sendMessage(chatId, `🔎 Buscando vuelos para: *${match[0]}*`, {parse_mode: "Markdown"});
    }

    try {
        const {response} = await searchRegionalQuery(msg, match, fixedDay, isMultipleOrigin);
        if (send_message) {
            await sendMessageInChunks(match, bot, chatId, response, getInlineKeyboardMonths(match));
        }
        if (alert) {
            await check_alert(response, match, bot, alert);
        }
        return response
    } catch (error) {
        console.error(error.message);
        if (send_message) {
            await bot.sendMessage(chatId, `${match[0]}: ${buildError(error.message)}`);
        }
    }
};
const searchSingleDestination = async (match, msg, bot, send_message = true, alert = null) => {
    console.log(`${new Date().toLocaleTimeString()} ${alert ? "alert" : ""} ${msg.chat.username} ${match[0]}`);

    const chatId = msg.chat.id;
    if (send_message) {
        bot.sendMessage(chatId, `🔎 Buscando vuelos para: *${match[0]}*`, {parse_mode: "Markdown"})
    }

    try {
        const {response} = await searchCityQuery(msg, match);
        const inlineKeyboardMonths = getInlineKeyboardMonths(match);

        if (send_message) {
            await sendMessageInChunks(match, bot, chatId, response, inlineKeyboardMonths);
        }
        if (alert) {
            await check_alert(response, match, bot, alert);
        }
        return response
    } catch (error) {
        console.error(error.message);
        if (send_message) {
            await bot.sendMessage(chatId, `${match[0]}: ${buildError(error.message)}`);
        }

    }
}

const check_alert = async (res, groups, bot, alert) => {
    const saved_alert = await findAlert(alert);
    const send_alert = shouldSendAlert(saved_alert.alert.previous_result, res)
    await updateAlert(alert, res, send_alert); // always update alert with the latest result

    // if saved alert did not have a previous result or diff was not found , return
    if (saved_alert.alert.previous_result == null || !send_alert) return;

    console.log(`sending alert ${alert.search} to ${alert.username}`)
    await bot.sendMessage(alert.chat_id, `alert: ${alert.search} podría haber bajado de precio`);
    await sendMessageInChunks(bot, alert.chat_id, res, getInlineKeyboardMonths(groups));
}

function getMinPrice(text) {
    // if text does not contains jumpline (\n) return undefined
    if (!text.includes("\n")) return undefined;
    const lines = text.split('\n').filter(line => line.trim() !== '');
    let minPrice = lines.reduce((min, line) => {
        const price = parsePrice(line);
        return (price !== undefined) ? Math.min(min, price) : min;
    }, Infinity);
    return (minPrice !== Infinity) ? minPrice : undefined;
}

function parsePrice(text) {
    const asteriskRegex = /\*([^\*]+)\*/;
    const match = asteriskRegex.exec(text);
    if (!match) return undefined;

    const innerText = match[1];
    const firstNumber = parseInt(innerText.match(/(\d+)/)?.[1] || 0, 10);
    const numberWithK = parseInt(innerText.match(/(\d+)K/)?.[1] || 0, 10) * 1000;

    return firstNumber + numberWithK;
}


function shouldSendAlert(previous_result, new_result) {
    try {
        const previousMinPrice = getMinPrice(previous_result);
        if (previousMinPrice === undefined) {
            return true
        }
        const newMinPrice = getMinPrice(new_result);
        console.log(`previousMinPrice: ${previousMinPrice} newMinPrice: ${newMinPrice}. Should send alert: ${newMinPrice < previousMinPrice}`)
        return newMinPrice < previousMinPrice;
    } catch (e) {
        console.error("Error comparing alerts", e, previous_result, new_result);
        return false;
    }
}

const getInlineKeyboardMonths = (match) => {
    const [, origin, destination] = match;
    return monthSections.map((section, sectionIndex) => section.map((month, monthIndex) => ({
        text: month.name,
        callback_data: `${origin} ${destination} ${padMonth(section.length * sectionIndex + (monthIndex + 1))}`.trim(),
    })));
};

module.exports = {searchSingleDestination, searchMultipleDestination, sendMessageInChunks, getInlineKeyboardMonths};
