const axios = require('axios');
const {backOff} = require('exponential-backoff');
const {SMILES_URL, SMILES_TAX_URL, tripTypes} = require('../config/constants');
const {smiles, maxResults} = require('../config/config');
const {parseDate, calculateFirstDay, lastDays} = require('../utils/days');
const {getBestFlight} = require('../utils/calculate');
const {sortFlights, sortFlightsRoundTrip} = require('../flightsHelper');
const {belongsToCity} = require('../utils/parser');

const http = require('http');
const https = require('https');
const dns = require('dns');
const zlib = require('zlib');

// Set up custom DNS resolver
const customDnsResolver = new dns.promises.Resolver();
customDnsResolver.setServers(['1.1.1.1', '8.8.8.8']);

// Create a custom lookup function that supports both IPv4 and IPv6
const customLookup = (hostname, options, callback) => {
    if (options.family === 6) {
        // IPv6 lookup
        customDnsResolver.resolve6(hostname)
            .then((addresses) => {
                callback(null, addresses[0], 6); // return the first resolved IPv6 address
            })
            .catch((err) => {
                callback(err);
            });
    } else {
        // Default to IPv4 lookup
        customDnsResolver.resolve4(hostname)
            .then((addresses) => {
                callback(null, addresses[0], 4); // return the first resolved IPv4 address
            })
            .catch((err) => {
                callback(err);
            });
    }
};

const customHttpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: Infinity,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000,
    lookup: customLookup
});

const customHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: Infinity,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000,
    lookup: customLookup
});

// Setting the default agent for axios
axios.defaults.httpAgent = customHttpAgent;
axios.defaults.httpsAgent = customHttpsAgent;

axios.defaults.headers.common = {};
axios.defaults.headers.delete = {};
axios.defaults.headers.get = {};
axios.defaults.headers.head = {};
axios.defaults.headers.post = {};
axios.defaults.headers.put = {};
axios.defaults.headers.patch = {};

const agentOptions = {
    keepAlive: true,
    maxSockets: Infinity,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000
};

const searchHeaders2 = {
    'x-api-key': "aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw",
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "es-AR,es;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,es-419;q=0.5",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    //"Host": "content-prd.smiles.com.ar",
    "Origin": 'https:www.smiles.com.ar',
    "Pragma": "no-cache",
    "Referer": 'https://www.smiles.com.ar/',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Sec-GPC": "1",
    "User-Agent": 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "Chrome/",127.0.0.0 Safari/537.36',
    "sec-ch-ua": 'Not)A;Brand";v="99", "Brave";v="127", "Chromium";v="127',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "macOS",
}

const searchHeaders = {
    'x-api-key': "aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw",
    'user-agent': "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'content-type': 'application/json',
    'Origin': "https://www.smiles.com.ar",
    'Referer': 'https://www.smiles.com.ar/',
    'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,es-419;q=0.5',
    'Accept': 'application/json, text/plain, */*'
    /*  'accept-encoding': 'gzip, deflate, br, zstd',
      "accept": 'application/json, text/plain, *!/!*',
      'content-encoded': 'gzip',
      "Host": "api-air-flightsearch-blue.smiles.com.br",
      'origin': "https://www.smiles.com.ar",
  ,*/
}

const taxHeaders = {
    'x-api-key': 'aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw',
    'user-agent': "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    'accept-encoding': 'gzip',
}

const handleError = (error, id) => {
    const errorDetails = {
        message: error.message,
        code: error.code,
        config: error.config,
    };
    console.error(`could not get flight ${id}:`, JSON.stringify(errorDetails));
    return {data: {requestedFlightSegmentList: [{flightList: []}]}};
};


const API_FAILURE_RETRY_CODES = ["ETIMEDOUT", "EAI_AGAIN", "ECONNRESET", "ERR_BAD_RESPONSE"];
const FLIGHT_LIST_ERRORS = [
    "TypeError: Cannot read properties of undefined (reading 'flightList')",
    "TypeError: Cannot read property 'flightList' of undefined",
];
const SERVICE_UNAVAILABLE_STATUS = 503;

const shouldRetry = (error) => {
    const isFlightListRelatedError = FLIGHT_LIST_ERRORS.includes(error.response?.data?.error);
    const isServiceUnavailable = error.response?.status === SERVICE_UNAVAILABLE_STATUS;
    return isFlightListRelatedError || isServiceUnavailable || API_FAILURE_RETRY_CODES.includes(error.code);
};

const searchFlights = async (params) => {
    const maxAttempts = 1; // more retries affects rate limiting
    let attempts = 0;
    const search = `${params.originAirportCode} ${params.destinationAirportCode} ${params.departureDate}`

    const response = await backOff(
        async () => {
            attempts++;
            if (attempts > 1) {
                console.log(`retrying ${search}`);
            }
            const res = await axios.get(SMILES_URL + '/search', {
                params: params,
                headers: searchHeaders,
                timeout: 51 * 1000,
                insecureHTTPParser: true,
            })
            return res
        },
        {
            jitter: "full",
            numOfAttempts: maxAttempts,
            retry: (error, attemptNumber) => {
                const retry = shouldRetry(error);
                console.log(`error getting flight details for ${search}`,
                    JSON.stringify({
                        will_retry: retry,
                        attemptNumber: attemptNumber - 1,
                        message: error.message,
                        code: error.code
                    }));
                return retry
            },
        }
    );

    if (response.error && attempts >= maxAttempts) {
        return handleError(response.error, search);
    }

    if (attempts > 1) {
        console.log(`retry success ${search}`);
    }

    return response;
};

const createFlightObject = async (flightResult, preferences, cabinType) => {
    const {flight, price, money, fareUid} = getBestFlight(
        flightResult.data?.requestedFlightSegmentList[0],
        {...preferences, cabinType},
        preferences?.smilesAndMoney ? 'SMILES_MONEY_CLUB' : 'SMILES_CLUB'
    );
    return {
        origin: flight.departure?.airport?.code,
        destination: flight.arrival?.airport?.code,
        price,
        money,
        departureDay: parseInt(flight.departure?.date?.substring(8, 10)),
        stops: flight.stops?.toString(),
        duration: flight.duration?.hours?.toString(),
        airline: flight.airline?.name,
        seats: flight.availableSeats?.toString(),
        tax: fareUid
            ? await getTax(flight.uid, fareUid, preferences?.smilesAndMoney)
            : undefined,
    };
};

const getFlights = async (parameters) => {
    const {origin, destination, departureDate, cabinType, adults, preferences, startDate, endDate} = parameters;
    const lastDayOfMonthDeparture = lastDays.get(departureDate.substring(5));
    const getFlightPromises = [];
    const startDateFinal = parseInt(startDate > 0 ? startDate : calculateFirstDay(departureDate));
    const endDateFinal = parseInt(endDate > 0 ? endDate : lastDayOfMonthDeparture);


    for (let day = startDateFinal; day <= endDateFinal; day++) {
        const params = buildParams(origin, destination, departureDate.replace("/", "-"), adults, false, day, preferences?.brasilNonGol);
        getFlightPromises.push(searchFlights(params));
    }

    const flightResults = (await Promise.allSettled(getFlightPromises))
        .filter(result => result.status === 'fulfilled')  // Filtering out the fulfilled promises
        .map(result => result.value)  // Extracting the value of the fulfilled promises
        .flat();  // Flattening the array of results

    if (flightResults.length > 0) {
        console.log("fetching tax")
    }
    const mappedFlightResults = (
        await Promise.all(flightResults.map(flightResult => createFlightObject(flightResult, preferences, cabinType)))
    )
        .filter(flight => validFlight(flight));

    return {
        results: sortFlights(mappedFlightResults).slice(0, getBestFlightsCount(preferences?.maxresults)),
        departureMonth: departureDate.substring(5, 7),
    };
};

const getFlightsMultipleCities = async (parameters, fixedDay, isMultipleOrigin) => {
    const {origin, destination, departureDate, cabinType, adults, preferences, startDate, endDate} = parameters;
    const multipleCity = isMultipleOrigin ? origin : destination;
    const lastDayOfMonthDeparture = lastDays.get(departureDate.substring(5));
    const getFlightPromises = [];
    let startDateFinal = parseInt(startDate > 0 ? startDate : calculateFirstDay(departureDate));
    let endDateFinal = parseInt(endDate > 0 ? endDate : lastDayOfMonthDeparture);
    if (fixedDay) {
        startDateFinal = 0
        endDateFinal = 1
    }

    for (const city of multipleCity) {
        for (let day = startDateFinal; day <= endDateFinal; day++) {
            const params = buildParams(isMultipleOrigin ? city : origin, isMultipleOrigin ? destination : city, departureDate.replace("/", "-"), adults, fixedDay, fixedDay ? undefined : day, preferences?.brasilNonGol);
            getFlightPromises.push(searchFlights(params));
        }
    }

    // Using Promise.allSettled instead of Promise.all
    const flightResults = (await Promise.allSettled(getFlightPromises))
        .filter(result => result.status === 'fulfilled')  // Filtering out the fulfilled promises
        .map(result => result.value)  // Extracting the value of the fulfilled promises
        .flat();  // Flattening the array of results

    console.log("fetch tax")
    const mappedFlightResults = (
        await Promise.all(flightResults.map(flightResult => createFlightObject(flightResult, preferences, cabinType)))
    )
        .filter(flight => validFlight(flight));

    return {
        results: sortFlights(mappedFlightResults.flat()).slice(0, getBestFlightsCount(preferences?.maxresults)),
    };
};
const getFlightsRoundTrip = async (parameters) => {
    const {
        origin,
        destination,
        departureDate,
        returnDate,
        adultsGoing,
        cabinTypeGoing,
        adultsComing,
        cabinTypeComing,
        minDays,
        maxDays,
        preferences
    } = parameters;
    const lastDepartureDate = new Date(returnDate);
    const firstReturnDate = new Date(departureDate);
    const getFlightPromises = [];

    lastDepartureDate.setDate(lastDepartureDate.getDate() - minDays);
    firstReturnDate.setDate(firstReturnDate.getDate() + minDays);

    for (let date = new Date(departureDate); date <= lastDepartureDate; date.setDate(date.getDate() + 1)) {
        const paramsGoing = buildParams(origin, destination, date.toLocaleDateString("fr-CA"), adultsGoing, true, undefined, preferences?.brasilNonGol);
        getFlightPromises.push(searchFlights(paramsGoing));
    }

    for (let dateReturn = firstReturnDate; dateReturn <= new Date(returnDate); dateReturn.setDate(dateReturn.getDate() + 1)) {
        const paramsComing = buildParams(destination, origin, dateReturn.toLocaleDateString("fr-CA"), adultsComing, true, undefined, preferences?.brasilNonGol);
        getFlightPromises.push(searchFlights(paramsComing));
    }

    const flightResults = (await Promise.allSettled(getFlightPromises))
        .filter(result => result.status === 'fulfilled')  // Filtering out the fulfilled promises
        .map(result => result.value)  // Extracting the value of the fulfilled promises
        .flat();  // Flattening the array of results

    const mappedFlightResults = (await Promise.allSettled(flightResults.map(flightResult => {
        const cabinType = belongsToCity(flightResult.data?.requestedFlightSegmentList[0]?.airports?.departureAirportList[0]?.code, origin) ? cabinTypeGoing : cabinTypeComing;
        return createFlightObject(flightResult, preferences, cabinType);
    }))).filter(flight => validFlight(flight));

    return {
        results: sortFlightsRoundTrip(mappedFlightResults, minDays, maxDays, origin).slice(0, getBestFlightsCount(preferences?.maxresults)),
    };
};


const buildParams = (
    origin,
    destination,
    departureDate,
    adults,
    fixedDay,
    specificDay,
    brasilNonGol
) => {
    let forceCongener = "true";
    if (brasilNonGol !== undefined) {
        forceCongener = brasilNonGol ? "true" : "false";
    }

    return {
        adults: adults || "1",
        cabinType: "all",
        children: "0",
        currencyCode: "ARS",
        infants: "0",
        isFlexibleDateChecked: "false",
        tripType: tripTypes.ONE_WAY,
        forceCongener: forceCongener,
        r: "ar",
        originAirportCode: origin,
        destinationAirportCode: destination,
        departureDate: fixedDay
            ? departureDate
            : parseDate(departureDate, specificDay),
    }
};

const getTax = async (uid, fareuid, isSmilesMoney) => {
    const params = {
        adults: "1",
        children: "0",
        infants: "0",
        fareuid,
        uid,
        type: "SEGMENT_1",
        highlightText: isSmilesMoney ? "SMILES_MONEY_CLUB" : "SMILES_CLUB",
    };
    try {
        const res = await axios.get(SMILES_TAX_URL + '/boardingtax', {
            params: params,
            headers: taxHeaders,
            timeout: 50 * 1000,
            insecureHTTPParser: false,
        })
        const data = res.data

        const milesNumber = data?.totals?.totalBoardingTax?.miles;
        const moneyNumber = data?.totals?.totalBoardingTax?.money;
        return {
            miles: `${Math.floor(milesNumber / 1000)}K`,
            milesNumber,
            money: `$${Math.floor(moneyNumber / 1000)}K`,
            moneyNumber,
        };
    } catch (error) {
        console.error(`could not get tax of ${uid}:`, JSON.stringify({
            message: error.message,
            code: error.code
        }));
        return undefined
    }
};
const validFlight = (flight) =>
    flight.price &&
    flight.price !== Number.MAX_VALUE.toString() &&
    flight.tax?.miles;
const getBestFlightsCount = (preferencesMaxResults) =>
    !preferencesMaxResults
        ? parseInt(maxResults, 10)
        : parseInt(preferencesMaxResults, 10);

module.exports = {getFlights, getFlightsMultipleCities, getFlightsRoundTrip};
