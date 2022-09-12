const TelegramBot = require("node-telegram-bot-api");
const emoji = require("node-emoji");
const FlightSearch = require("../models/FlightSearch");
const { telegramApiToken } = require("../config/config");
const dbOperations = require("../db/operations");
const {
  notFound,
  telegramStart,
  genericError,
  searching,
  regions,
  retry,
  cafecito,
  links,
} = require("../config/constants");
const {
  generatePayloadMonthlySingleDestination,
  generatePayloadMultipleDestinations,
  generatePayloadMultipleOrigins,
  generatePayloadRoundTrip,
  applySimpleMarkdown,
  generateFlightOutput,
  generateEmissionLink,
  generateEmissionLinkRoundTrip,
} = require("../utils/parser");
const {
  getFlights,
  getFlightsMultipleCities,
  getFlightsRoundTrip,
} = require("../clients/smilesClient");

const {
  regexSingleCities,
  regexMultipleDestinationMonthly,
  regexMultipleDestinationFixedDay,
  regexMultipleOriginMonthly,
  regexMultipleOriginFixedDay,
  regexRoundTrip,
} = require("../utils/regex");

const listen = async () => {
  const { createOne } = await dbOperations("flight_search");
  const bot = new TelegramBot(telegramApiToken, { polling: true });

  bot.onText(/\/start/, async (msg) =>
    bot.sendMessage(msg.chat.id, telegramStart, { parse_mode: "MarkdownV2" })
  );

  bot.onText(/\/regiones/, async (msg) => {
    const airports = Object.entries(regions).reduce(
      (phrase, current) =>
        phrase.concat(
          applySimpleMarkdown(current[0], "__") + ": " + current[1] + "\n\n"
        ),
      ""
    );
    bot.sendMessage(msg.chat.id, airports, { parse_mode: "MarkdownV2" });
  });

  bot.onText(/\/cafecito/, async (msg) =>
    bot.sendMessage(msg.chat.id, cafecito, { parse_mode: "MarkdownV2" })
  );

  bot.onText(/\/links/, async (msg) =>
    bot.sendMessage(msg.chat.id, links, { parse_mode: "MarkdownV2" })
  );

  bot.onText(regexSingleCities, async (msg) => {
    const chatId = msg.chat.id;

    const payload = generatePayloadMonthlySingleDestination(msg.text);
    bot.sendMessage(chatId, searching);
    try {
      const flightList = await getFlights(payload);
      const bestFlights = flightList.results;
      if (flightList.error) {
        return bot.sendMessage(chatId, flightList.error);
      }
      if (bestFlights.length === 0) {
        return bot.sendMessage(chatId, notFound);
      }
      const response = bestFlights.reduce(
        (previous, current) =>
          previous.concat(
            emoji.get("airplane") +
              applySimpleMarkdown(
                current.departureDay + "/" + flightList.departureMonth,
                "[",
                "]"
              ) +
              applySimpleMarkdown(
                generateEmissionLink({
                  ...payload,
                  departureDate:
                    payload.departureDate + "-" + current.departureDay + " 09:",
                  tripType: "2",
                }),
                "(",
                ")"
              ) +
              ": " +
              applySimpleMarkdown(
                `${current.price.toString()} + ${current.tax.miles}/${current.tax.money}`,
                "*"
              ) +
              generateFlightOutput(current) +
              "\n"
          ),
        payload.origin + " " + payload.destination + "\n"
      );
      console.log(msg.text);
      bot.sendMessage(chatId, response, { parse_mode: "Markdown" });

      await createFlightSearch(
        {
          id: msg.from.username || msg.from.id.toString(),
          origin: payload.origin,
          destination: payload.destination,
          departureDate: payload.departureDate,
          price: bestFlights[0].price,
        },
        createOne
      );
    } catch (error) {
      console.log(error);
      bot.sendMessage(chatId, genericError);
    }
  });

  bot.onText(
    regexMultipleDestinationMonthly,
    async (msg) => await searchRegionalQuery(bot, msg, false, false)
  );

  bot.onText(
    regexMultipleDestinationFixedDay,
    async (msg) => await searchRegionalQuery(bot, msg, true, false)
  );

  bot.onText(
    regexMultipleOriginMonthly,
    async (msg) => await searchRegionalQuery(bot, msg, false, true)
  );

  bot.onText(
    regexMultipleOriginFixedDay,
    async (msg) => await searchRegionalQuery(bot, msg, true, true)
  );

  bot.onText(regexRoundTrip, async (msg) => {
    const chatId = msg.chat.id;
    const payload = generatePayloadRoundTrip(msg.text);
    try {
      bot.sendMessage(chatId, searching);
      const flightList = await getFlightsRoundTrip(payload);

      const bestFlights = flightList.results;
      if (flightList.error) {
        return bot.sendMessage(chatId, flightList.error);
      }
      if (bestFlights.length === 0) {
        return bot.sendMessage(chatId, notFound);
      }

      const response = bestFlights.reduce(
        (previous, current) =>
          previous.concat(
            emoji.get("airplane") +
              applySimpleMarkdown(
                current.departureFlight.departureDay.getDate() +
                  "/" +
                  (current.departureFlight.departureDay.getMonth() + 1) +
                  " - " +
                  current.returnFlight.departureDay.getDate() +
                  "/" +
                  (current.returnFlight.departureDay.getMonth() + 1),
                "[",
                "]"
              ) +
              applySimpleMarkdown(
                generateEmissionLinkRoundTrip({
                  ...payload,
                  departureDate:
                    current.departureFlight.departureDay.setHours(9),
                  returnDate: current.returnFlight.departureDay.setHours(9),
                  tripType: "1",
                }),
                "(",
                ")"
              ) +
              ": " +
              applySimpleMarkdown(
                `${current.departureFlight.price.toString()} + ${
                  current.returnFlight.price.toString()
                } + ${Math.floor(
                  (current.departureFlight.tax.milesNumber +
                    current.returnFlight.tax.milesNumber) /
                    1000
                ).toString()}K/$${Math.floor(
                  (current.departureFlight.tax.moneyNumber +
                    current.returnFlight.tax.moneyNumber) /
                    1000
                ).toString()}K`,
                "*"
              ) +
              "\n IDA:" +
              generateFlightOutput(current.departureFlight) +
              "\n VUELTA:" +
              generateFlightOutput(current.returnFlight) +
              "\n"
          ),
        payload.origin + " " + payload.destination + "\n"
      );
      console.log(msg.text);
      bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
    } catch (error) {
      console.log(error);
      bot.sendMessage(chatId, genericError);
    }
  });
};

listen();

const searchRegionalQuery = async (
  bot,
  msg,
  fixedDay,
  isMultipleOrigin,
  attempt = 1
) => {
  const chatId = msg.chat.id;
  const payload = isMultipleOrigin
    ? generatePayloadMultipleOrigins(msg.text, fixedDay)
    : generatePayloadMultipleDestinations(msg.text, fixedDay);
  try {
    bot.sendMessage(chatId, searching);
    const flightList = await getFlightsMultipleCities(
      payload,
      fixedDay,
      isMultipleOrigin
    );
    const bestFlights = flightList.results;

    if (!bestFlights) {
      // if (attempt <= 3) {
      //   bot.sendMessage(chatId, retry(attempt));
      //   await searchRegionalQuery(bot, msg, fixedDay, attempt + 1);
      //   return;
      // } else {
      //   throw new Error();
      // }
      throw new Error();
    }

    if (flightList.error) {
      return bot.sendMessage(chatId, flightList.error);
    }
    if (bestFlights.length === 0) {
      return bot.sendMessage(chatId, notFound);
    }

    const flightTitle = isMultipleOrigin
      ? `${payload.region} ${payload.destination} ${payload.departureDate}\n`
      : `${payload.origin} ${payload.region} ${payload.departureDate}\n`;

    const response = bestFlights.reduce((previous, current) => {
      const dateToShow = fixedDay
        ? ""
        : " " +
          current.departureDay +
          "/" +
          payload.departureDate.substring(5, 7);
      return previous.concat(
        emoji.get("airplane") +
          applySimpleMarkdown(
            (isMultipleOrigin ? current.origin : current.destination) +
              dateToShow,
            "[",
            "]"
          ) +
          applySimpleMarkdown(
            generateEmissionLink({
              ...payload,
              origin: isMultipleOrigin ? current.origin : payload.origin,
              destination: isMultipleOrigin
                ? payload.destination
                : current.destination,
              departureDate:
                payload.departureDate + "-" + current.departureDay + " 09:",
              tripType: "2",
            }),
            "(",
            ")"
          ) +
          ": " +
          applySimpleMarkdown(
            `${current.price.toString()} + ${current.tax.miles}/${current.tax.money}`,
            "*"
          ) +
          generateFlightOutput(current) +
          "\n"
      );
    }, flightTitle);
    console.log(msg.text);
    bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
  } catch (error) {
    console.log(error);
    bot.sendMessage(chatId, genericError);
  }
};

const createFlightSearch = async (data, createOne) => {
  const { id, origin, destination, departureDate, price } = data;

  const flightSearch = new FlightSearch(
    id,
    "telegram",
    new Date(),
    origin,
    destination,
    departureDate.substring(0, 4),
    departureDate.substring(5, 7),
    price
  );
  await createOne(flightSearch);
};
