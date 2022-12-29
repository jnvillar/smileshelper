const marked = require("marked");
const TerminalRenderer = require("marked-terminal");
const readline = require("readline");
const util = require("util");
const { searchForFlights } = require("./search-helper");
const { searching } = require("../config/constants");
const markdown = require("../utils/markdown");

marked.setOptions({
  renderer: new TerminalRenderer(),
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = util.promisify(rl.question).bind(rl);

async function makeQuestion(text) {
  const answer = await question(text);
  return answer.trim();
}

const questionText = "Ingrese búsqueda (q para salir): ";

async function run() {
  let query = await makeQuestion(questionText);

  while (query !== "q") {
    console.log(searching);
    try {
      const { flights, payload } = await searchForFlights(query);
      const flightsMarkdown = marked.parse(
        markdown.parseFlightsFromQuery({ flights, payload, query }),
      );
      console.log(flightsMarkdown);
    } catch (error) {
      console.error("Error: " + error.message);
    }
    query = await makeQuestion(questionText);
  }

  rl.close();
}

run();
