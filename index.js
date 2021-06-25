const TeleBot = require('telebot');
const app = require("express")();
const cron = require("node-cron");

const {BOT_TOKEN: token} = process.env;
const bot = new TeleBot({
  token,
  usePlugins: ['askUser']
});

const validate = require("./scripts/validation");
const util = require("./scripts/utility");
const db = require("./scripts/database");
const delim = "-";



bot.on(['/start', '/begin'], async msg => {
  const user = { ...msg.from }
  const res = await db.addUser(user);
  if (res)
    msg.reply.text(`Welcome! ${user.first_name}`);
});



bot.on(['/help'], async msg => {
  const { id } = msg.from;
  msg.reply.text(`Following commands can be used${getHelp()}`);
});



bot.on(["/add", "/remind"], async msg => {
  const { id } = msg.from;
  const userExist = await db.isUser(id);
  if (!userExist) return bot.sendMessage(id, "please /start the bot");


  return bot.sendMessage(id, `Enter your task in the format: \ndate${delim}month${delim}year\nReminder Name\nDescription\n\nskip ${delim}year if its a yearly recurring or use 0 for year`, { ask: "task_add" });
});

bot.on("ask.task_add", async msg => {
  const { id } = msg.from;
  let message = new String();

  try {
    const task = util.extractTaskFromString(msg.text);

    message = await db.addTask(id, task) ? "done" : "unable to add reminder";
  } catch (ex) {
    message = ex.message;
    console.log(ex);
  }

  return bot.sendMessage(id, "add: " + message);
});



bot.on(["/delete", "/remove"], async msg => {
  const { id } = msg.from;
  const userExist = await db.isUser(id);
  if (!userExist) return bot.sendMessage(id, "please /start the bot");

  return getList(msg, "To delete a reminder send\ndate-month-year:ReminderNumber", { ask: "task_delete" });
});

bot.on("ask.task_delete", async msg => {
  const { id } = msg.from;
  let result = new String();
  
  try {
    const [day, taskNo] = util.extractModificationString(msg.text);
    const date = new Date(util.swapMonthDate(day));
  
    if(!taskNo || isNaN(parseInt(taskNo)) || !validate.day(date) || !validate.dateString(day))
      throw new Error("Wrong format");

    result = await db.deleteTask(id, taskNo - 1, date) ? "done" : "task not found";
  } catch (ex) {
    result = ex.message;
    console.log(ex);
  }

  return bot.sendMessage(id, "delete: " + result);
});



bot.on(["/list", "/get"], async msg => {
  await getList(msg, "Your reminders are as follows");
});



bot.on(["/listOf", "/getOf"], async msg => {
  const { id } = msg.from;
  const userExist = await db.isUser(id);
  if (!userExist) return bot.sendMessage(id, "please /start the bot");

  bot.sendMessage(id, "Send a date in the format\ndate-month-year", {ask: "task_get_of"});
});

bot.on("ask.task_get_of", async msg => {
  const { id } = msg.from;
  let result = new String();
  try {
    const day = util.swapMonthDate(msg.text);
    const date = new Date(day);
    if(!validate.day(date) || !validate.dateString(day)) 
      throw new Error("Wrong format");
    
    if(day.split().length<3)
      date.setFullYear(2000);
    
    const tasks = await db.getTasksOfDate(id, date);
    const exists = tasks? !(tasks.findIndex(task => util.compareYear(new Date(task.date), date)) === -1) : false;
    
    if(!tasks || !exists)
      throw new Error("No reminders found");

    for(const [taskNo, task] of Object.entries(tasks))
      result += util.populateTaskMessage(task, taskNo);
    
  } catch (ex) {
    console.error(ex);
    result = ex.message;
  }
  return bot.sendMessage(id, result, { parseMode: 'Markdown'});
})



bot.on(["/update"], async msg => {
  await getList(msg, "To update a reminder send\ndate-month-year:ReminderNumber\ndate-month-year\nSubject\nDescription", { ask: "task_update" });
});

bot.on("ask.task_update", async msg => {
  const { id } = msg.from;
  let result = new String();
  try {
    const [modificationPart, ...taskPart] = msg.text.split("\n");
    const [day, taskNo] = util.extractModificationString(modificationPart);
    const changedTask = util.extractTaskFromString(taskPart.join("\n"), {suppress: true});
    const date = new Date(util.swapMonthDate(day));

    if (String(changedTask.date) === "Invalid Date")
      delete changedTask.date;
    if(!(day && date && taskNo && changedTask))
      throw new Error("Wrong format");
    
    result = await db.updateTask(id, changedTask, taskNo - 1, date) ? "done" : "task not found";
  } catch (ex) {
    result = ex.message;
    console.log(ex);
  }
  return bot.sendMessage(id, "update: " + result);
});




app.get("/", (req, res)=>{
  res.send("Up!");
});


app.listen(process.env.PORT || 3000, () => {
  console.log("listening...");
  bot.start();
  cron.schedule("0 0 * * *", runEveryday, {timezone: "Asia/Kolkata"});
});


async function runEveryday(){
  const today =  new Date();
  const users = await db.getAllUsers();
  users.forEach(async user=>{
    const tasks = await db.getTasksOfDate(user.id, today);
    const tasksToRemind = tasks ? tasks.filter(task=>{
      const taskDate = new Date(task.date);
      return util.compareYear(taskDate, today) || util.compareYear(taskDate, new Date("1-1-2000"))
    }) : null;

    if(!tasksToRemind)
     return;
    tasksToRemind.forEach(task=>{
      const message = util.populateTaskMessage(task);
      bot.sendMessage(user.id, message, {parseMode: 'Markdown'});
    });
  });
}

getList = async (msg, firstLine, options) => {
  const { id } = msg.from;
  const userExist = await db.isUser(id);

  if (!userExist) return bot.sendMessage(id, "please /start the bot");
  let message = "";

  try {
    let res = await db.getTasks(id);
    message = util.populateListMessage(res, firstLine);
  } catch (ex) {
    console.log(ex);
    message = ex.message;
  }
  
  return bot.sendMessage(id, message, { parseMode: 'Markdown', ...options});
}

function getHelp(){
  const commands = [
    {
      command: "start",
      alias: "begin",
      description: "starts the bot"
    },
    {
      command: "help",
      description: "show all commands"
    },
    {
      command: "list",
      alias: "get",
      description: "get all the reminders"
    },
    {
      command: "listOf",
      alias: "getOf",
      description: "get all the reminders of a specific date"
    },
    {
      command: "add",
      alias: "remind",
      description: "add new reminder"
    },
    {
      command: "update",
      description: "update a reminder"
    },
    {
      command: "remove",
      alias: "delete",
      description: "delete a reminder"
    },
    {
      command: "add",
      alias: "remind",
      description: "add new reminder"
    },
  ];
  let commandsText = new String();
  commands.forEach(cmd=>{
    commandsText += `\n/${cmd.command} or /${cmd.alias}\n${cmd.description}\n`;
  });
  return commandsText;
}
