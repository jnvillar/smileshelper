const TelegramBot = require("node-telegram-bot-api");
const {telegramApiToken, telegramApiTokenLocal} = require("../config/config");
const {
    telegramStart,
    links,
    airlinesCodes,
    searching,
    maxAirports,
} = require("../config/constants");
const regions = require("../data/regions");
const {applySimpleMarkdown} = require("../utils/parser");

const {
    regexSingleCities,
    regexMultipleDestinationMonthly,
    regexMultipleDestinationFixedDay,
    regexMultipleOriginMonthly,
    regexMultipleOriginFixedDay,
    regexRoundTrip,
    regexFilters,
    regexCustomRegion,
    regexCron,
    regexAlert,
    regexDeleteAlert,
} = require("../utils/regex");

const {searchRoundTrip} = require("./search");

const cron = require("node-cron");

const isLocal = process.env.TELEGRAM_LOCAL === 'true';

const {
    getPreferences,
    getRegions,
    setPreferences,
    deletePreferences,
    setRegion,
    createCron,
    updateAlert,
    findAlert,
    getCrons,
    getAlerts,
    getAllCrons,
    getAllAlerts,
    createAlert,
    deleteAlert,
} = require("./preferences");

const {initializeDbFunctions} = require("../db/dbFunctions");
const {
    searchSingleDestination,
    searchMultipleDestination,
} = require("./telegramBotHandler");
const {save} = require("node-cron/src/storage");

async function reloadCrons(bot) {
    console.log("reloading crons and alerts")
    await deleteAllCrons()
    await loadCrons(null, bot)
    await loadAlerts(bot)
    console.log("crons and alerts reloaded")
}

async function deleteAllCrons() {
    cron.getTasks().forEach(task => task.stop())
}

async function loadAlerts(bot) {
    // Fetch all alerts
    const alerts = await getAllAlerts();

    // Check if there are any alerts to load
    if (alerts.length === 0) {
        return alerts;
    }

    // Loop through each alert and attempt to load it
    alerts.forEach(alert => {
        try {
            loadAlert(bot, alert);
            console.log(`Loaded alert ${alert.username} ${alert.cron} ${alert.search}`);
        } catch (e) {
            console.log(`Could not load alert ${alert.username} ${alert.cron} ${alert.search}`);
            console.error(e);  // Log the error for debugging
        }
    });

    return alerts;
}

async function loadCrons(msg, bot) {
    // Load crons based on the presence of 'msg'
    const crons = msg ? await getCrons(msg) : await getAllCrons();

    // Check if there are any crons to load
    if (crons.length === 0) {
        return crons;
    }

    // Loop through each cron and attempt to load it
    crons.forEach(c => {
        try {
            loadCron(bot, c);
            console.log(`Loaded cron ${c.username} ${c.cron} ${c.search} `);
        } catch (e) {
            console.log(`Could not run cron ${c.search} ${c.cron} ${c.username}`);
            console.error(e);  // Log the error for debugging
        }
    });

    return crons;
}


async function handleSearch(searchText, msg, bot, send_message = true, alert = null) {
    let res;
    let groups;
    switch (true) {
        case regexSingleCities.test(searchText):
            groups = regexSingleCities.exec(searchText);
            res = await searchSingleDestinationWrapper(groups, msg, bot, send_message, alert)
            break;
        case regexMultipleDestinationMonthly.test(searchText):
            groups = regexMultipleDestinationMonthly.exec(searchText);
            res = await searchMultipleDestinationWrapper(groups, msg, bot, false, false, send_message, alert)
            break;
        case regexMultipleDestinationFixedDay.test(searchText):
            groups = regexMultipleDestinationFixedDay.exec(searchText);
            res = await searchMultipleDestinationWrapper(groups, msg, bot, true, false, send_message, alert)
            break;
        case regexMultipleOriginMonthly.test(searchText):
            groups = regexMultipleOriginMonthly.exec(searchText);
            res = await searchMultipleDestinationWrapper(groups, msg, bot, false, true, send_message, alert)
            break;
        case regexMultipleOriginFixedDay.test(searchText):
            groups = regexMultipleOriginFixedDay.exec(searchText);
            res = await searchMultipleDestinationWrapper(groups, msg, bot, true, true, send_message, alert)
            break;
        default:
            console.log(`error: ${searchText} does not match any case`);
            res = null;
    }
    return {res: res, groups: groups}
}

async function loadAlert(bot, alert, just_created = false) {
    const msg = {"chat": {"id": alert.chat_id, "username": `alert: ${alert.username}`}};
    const searchText = alert.search;

    if (just_created) {
        const {res} = await handleSearch(searchText, msg, bot);
        await updateAlert(alert, res);
    }

    cron.schedule(alert.cron, async () => {
        await runAlert(bot, alert);
    });
}

async function runAlert(bot, alert, send_message = false) {
    try {
        const msg = {"chat": {"id": alert.chat_id, "username": `${alert.username}`}};
        const searchText = alert.search;
        await handleSearch(searchText, msg, bot, send_message, alert);
    } catch (e) {
        console.log(`error running alert: ${e.message}`);
    }
}


// Refactored loadCron function
async function loadCron(bot, c, just_created = false) {
    const msg = {"chat": {"id": c.chat_id, "username": `cron: ${c.username}`}};

    if (just_created) {
        try {
            await handleSearch(c.search, msg, bot);
        } catch (e) {
            console.log(e)
        }
    }

    cron.schedule(c.cron, async () => {
        try {
            await handleSearch(c.search, msg, bot);
        } catch (e) {
            console.log(`error running cron: ${e.message}`);
        }
    });
}

const getTelegramToken = () => {
    if (isLocal) {
        return telegramApiTokenLocal
    } else {
        return telegramApiToken
    }
}


const authorizedUsers = [
    "1379299692", // sandra
    "379299692", // SANDRA
    "leisanchez",
    "colopreda",
    "maticada",
    "juaninv",
    "julianherrera" // amigo nacho
];

function isUserAuthorized(bot, msg) {
    const userId = msg.from.id;
    let username = msg.from.username;
    if (username === undefined) {
        username = ""
    }
    const authorized = authorizedUsers.includes(userId.toString()) || authorizedUsers.includes(username.toLowerCase());
    if (!authorized) {
        console.log(`User ${userId} ${username} is not authorized to use the bot `)
        bot.sendMessage(userId, "👮 No estas autorizado a usar el bot");
        bot.sendMessage(183065878, `👮 Uso no autorizado del bot  ${userId} ${username}`);
    }
    return authorized;
}

const listen = async () => {
    let bot = new TelegramBot(getTelegramToken(), {polling: true});
    await initializeDbFunctions();
    await loadCrons(null, bot);
    await loadAlerts(bot);

    // Set your commands here
    bot.setMyCommands([
        {command: '/start', description: 'inicia el bot: /start'},
        {command: '/regiones', description: 'lista regiones: /regiones'},
        {command: '/links', description: 'lista links utiles: /links'},
        {command: '/aerolineas', description: 'lista codigos de aerolineas: /aerolineas'},
        {command: '/filtros', description: 'lista filtros: /filtros'},
        {command: '/filtroseliminar', description: 'elimina todos los filtros: /filtroseliminar'},
        {command: '/vercrons', description: 'lista crons: /vercrons'},
        {command: '/agregarcron', description: 'agrega cron: /agregarcron 12 30 BUE MIA 2024-05'},
        {command: '/agregaralerta', description: 'agrega alerta: /agregaralerta BUE MIA 2024-05'},
        {command: '/eliminaralerta', description: 'elimina alerta: /eliminaralerta BUE MIA 2024-05'},
        {command: '/veralertas', description: 'lista alertas: /veralertas'},
        {command: '/correralertas', description: 'corre alertas: /correralertas'},
        // Add more commands as needed
    ]);

    bot.onText(/\/start/, async (msg) => {
            if (!isUserAuthorized(bot, msg)) {
                return
            }
            bot.sendMessage(msg.chat.id, telegramStart, {parse_mode: "MarkdownV2"})
        }
    );

    bot.onText(/\/regiones/, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }

        const entries = {...regions, ...(await getRegions(msg))};
        const airports = Object.entries(entries).reduce(
            (phrase, current) =>
                phrase.concat(
                    applySimpleMarkdown(current[0], "__") + ": " + current[1] + "\n\n"
                ),
            ""
        );
        bot.sendMessage(msg.chat.id, airports, {parse_mode: "MarkdownV2"});
    });

    bot.onText(/\/links/, async (msg) => {
            if (!isUserAuthorized(bot, msg)) {
                return
            }
            bot.sendMessage(msg.chat.id, links, {parse_mode: "MarkdownV2"})
        }
    );

    bot.onText(/\/aerolineas/, async (msg) => {
            if (!isUserAuthorized(bot, msg)) {
                return
            }
            bot.sendMessage(msg.chat.id, airlinesCodes, {parse_mode: "MarkdownV2"})
        }
    );

    bot.onText(regexSingleCities, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        await searchSingleDestinationWrapper(match, msg, bot, true);
    });

    bot.onText(regexMultipleDestinationMonthly, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        await searchMultipleDestinationWrapper(match, msg, bot, false, false, true);
    });

    bot.onText(regexMultipleDestinationFixedDay, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        await searchMultipleDestinationWrapper(match, msg, bot, true, false, true);
    });

    bot.onText(regexMultipleOriginMonthly, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        await searchMultipleDestinationWrapper(match, msg, bot, false, true, true);
    });

    bot.onText(regexMultipleOriginFixedDay, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        await searchMultipleDestinationWrapper(match, msg, bot, true, true, true);
    });

    bot.onText(regexRoundTrip, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, searching);
        const {response, error} = await searchRoundTrip(msg);
        if (error) {
            bot.sendMessage(chatId, error);
        } else {
            bot.sendMessage(chatId, response, {parse_mode: "Markdown"});
        }
    });

    bot.on("callback_query", async (query) => {
        if (!isUserAuthorized(bot, query)) {
            return
        }
        const match = query.data.split(" ");
        const entireCommand = [query.data];
        if (match[0].length > 3) {
            await searchMultipleDestinationWrapper(
                entireCommand.concat(match),
                query.message,
                bot,
                false,
                true,
                true
            );
        } else if (match[1].length > 3) {
            await searchMultipleDestinationWrapper(
                entireCommand.concat(match),
                query.message,
                bot,
                false,
                false,
                true
            );
        } else {
            await searchSingleDestinationWrapper(
                entireCommand.concat(match),
                query.message,
                bot,
                true
            );
        }
    });

    bot.onText(regexFilters, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        let {response: response1, error: error1} = await setPreferences(msg);
        if (error1) {
            bot.sendMessage(chatId, error1);
        } else {
            bot.sendMessage(chatId, response1, {parse_mode: "Markdown"});
        }

        let {response: response2, error: error2} = await getPreferences(msg);
        if (error2) {
            bot.sendMessage(chatId, error2);
        } else {
            bot.sendMessage(chatId, response2, {parse_mode: "Markdown"});
        }
    });


    bot.onText(regexCustomRegion, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const regionName = match[1].toUpperCase();
        const regionAirports = match[2]
            .split(" ")
            .slice(0, maxAirports)
            .map((airport) => airport.toUpperCase());
        const {response, error} = await setRegion(
            msg,
            regionName,
            regionAirports
        );
        if (error) {
            bot.sendMessage(chatId, error);
        } else {
            bot.sendMessage(chatId, response, {parse_mode: "Markdown"});
        }
    });

    bot.onText(/\/filtroseliminar/, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const {response, error} = await deletePreferences(msg);
        await reloadCrons(bot)
        if (error) {
            bot.sendMessage(chatId, error);
        } else {
            bot.sendMessage(chatId, response, {parse_mode: "Markdown"});
        }
    });

    bot.onText(/\/filtros$/, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const {response, error} = await getPreferences(msg);
        if (error) {
            bot.sendMessage(chatId, error);
        } else {
            bot.sendMessage(chatId, response, {parse_mode: "Markdown"});
        }
    });

    bot.onText(regexAlert, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const searchText = match[1]
        const {alert} = await createAlert(msg, searchText);

        bot.sendMessage(chatId, "Procesando la alerta");
        await loadAlert(bot, alert, true)
        bot.sendMessage(chatId, `Se agregó la alerta correctamente. Si se encuentran cambios con respecto a esa búsqueda se te avisará por este medio. Para eliminarla, usa /eliminaralerta ${alert.search}`);
    })

    bot.onText(regexDeleteAlert, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const searchText = match[1]
        const {alert, error} = await deleteAlert(msg, searchText);
        if (alert !== undefined) {
            bot.sendMessage(chatId, `Se eliminó la alerta ${alert.search}`);
            reloadCrons(bot)
        }
        if (error !== undefined) {
            if (error === "not_found" || error === "no_alerts") {
                bot.sendMessage(chatId, `No se encontró la alerta ${searchText}`);
            } else {
                bot.sendMessage(chatId, `Error borrando la alerta ${searchText}`);
            }
        }
    })

    bot.onText(regexCron, async (msg, match) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const hour = match[1]
        const minute = match[2]
        const searchText = match[3]

        if (hour !== "*" && (parseInt(hour) > 23 || parseInt(hour) < 0)) {
            bot.sendMessage(chatId, "La hora debe estar entre 0 y 23");
            return
        }

        if (minute !== "*" && (parseInt(minute) > 59 || parseInt(minute) < 0)) {
            bot.sendMessage(chatId, "El minuto debe estar entre 0 y 59");
            return
        }

        // Both hour and minute are specific
        if (hour !== "*" && minute !== "*") {
            cronCmd = `0 ${minute} ${hour} * * *`;
        }
        // Every given amount of hours
        else if (minute === "*") {
            cronCmd = `0 0 */${hour} * * *`;
        }
        // Every given amount of minutes
        else if (hour === "*") {
            cronCmd = `0 */${minute} * * * *`;
        }
        // Both hour and minute are "*"
        else if (hour === "*" && minute === "*") {
            cronCmd = `0 * * * * *`;  // Every minute of every hour
        }


        const {_, cron} = await createCron(msg, cronCmd, searchText)
        bot.sendMessage(chatId, "Procesando cron");
        await loadCron(bot, cron, true)
        bot.sendMessage(chatId, "Se agregó el cron correctamente. Para eliminarlo, usa /filtroseliminar");
    })

    bot.onText(/\/vercrons/, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const crons = await getCrons(msg)
        if (crons.length === 0) {
            bot.sendMessage(chatId, "No hay crons");
            return
        }

        bot.sendMessage(chatId, "Lista de crons:");
        for (const cron of crons) {
            bot.sendMessage(chatId, `${cron.search} - ${cron.cron}`);
        }
    })

    bot.onText(/\/veralertas/, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const alerts = await getAlerts(msg)
        if (alerts.length === 0) {
            bot.sendMessage(chatId, "No hay alertas");
            return
        }

        await bot.sendMessage(chatId, "Lista de alertas");
        for (const alert of alerts) {
            bot.sendMessage(chatId, `${alert.search} - ${alert.cron}`);
        }

    })

    bot.onText(/\/correralertas/, async (msg) => {
        if (!isUserAuthorized(bot, msg)) {
            return
        }
        const chatId = msg.chat.id;
        const alerts = await getAlerts(msg)
        if (alerts.length === 0) {
            bot.sendMessage(chatId, "No hay alertas");
            return
        }

        for (const alert of alerts) {
            await runAlert(bot, alert, true)
        }
    })
};

process.env.TZ = 'America/Argentina/Buenos_Aires'
listen();

const queue = [];
const intervalInSeconds = 65;
const rateLimitInterval = intervalInSeconds * 1000;
let lastRequestTime = 0; // Timestamp of the last processed request
let isProcessing = false;


async function enqueueRequest(requestFunction, args, chat_id, bot, send_message) {
    queue.push({requestFunction, args});

    if (send_message) {
        let queue_size = queue.length - 1;
        let estimated_time = queue_size * rateLimitInterval / 1000
        if (Date.now() - lastRequestTime < rateLimitInterval) {
            estimated_time += intervalInSeconds - Math.ceil((Date.now() - lastRequestTime) / 1000)
        }
        await bot.sendMessage(chat_id, `🔎 La búsqueda: *${args[0][0]}* fue encolada.\n👥 Posición en la cola: ${queue_size}.\n⏳ Demora estimada: ${estimated_time} segundos.`, {parse_mode: "Markdown"});
    }
}

async function processQueue() {

    if (isProcessing || queue.length === 0 || (Date.now() - lastRequestTime) < rateLimitInterval) {
        return;
    }

    isProcessing = true;
    const {requestFunction, args} = queue[0];

    try {
        await requestFunction(...args);
    } catch (error) {
        console.error("Error processing request:", error);
    } finally {
        lastRequestTime = Date.now();
        queue.shift()
        isProcessing = false;
    }
}

// Start continuous checking instead of continuous processing
setInterval(processQueue, 500); // Check the queue every second

// Wrap your search functions for queueing
async function searchMultipleDestinationWrapper(...args) {
    let send_message = true;
    let alert = null;
    if (args.length >= 6) {
        send_message = args[5];
    }
    if (args.length >= 7) {
        alert = args[6];
    }
    await enqueueRequest(searchMultipleDestination, args, args[1].chat.id, args[2], send_message, alert);
}

async function searchSingleDestinationWrapper(...args) {
    let send_message = true;
    let alert = null;
    if (args.length >= 4) {
        send_message = args[3];
    }
    if (args.length >= 5) {
        alert = args[4];
    }
    await enqueueRequest(searchSingleDestination, args, args[1].chat.id, args[2], send_message, alert);
}
