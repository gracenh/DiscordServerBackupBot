const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
require('dotenv').config();
const config = require('./config.json');

// Global state to track active scraping operations
global.scrapingState = {
  isActive: false,
  channelId: null,
  processedCount: 0,
  shouldStop: false
};

// Set up the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Load all slash commands from /commands
client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

// Event: Bot ready
client.once(Events.ClientReady, () => {
  console.log(` Logged in as ${client.user.tag}`);
  // Ensure global state is initialized
  if (!global.scrapingState) {
    global.scrapingState = {
      isActive: false,
      channelId: null,
      processedCount: 0,
      shouldStop: false
    };
  }
});

// Event: Slash command interaction
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Optional: Restrict to admin only
  if (interaction.user.id !== config.adminId) {
    return interaction.reply({
      content: ' Only the bot admin can use this command.',
      flags: 64 // Ephemeral flag
    });
  }

  // Ensure global state exists before executing command
  if (!global.scrapingState) {
    global.scrapingState = {
      isActive: false,
      channelId: null,
      processedCount: 0,
      shouldStop: false
    };
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(" Error running command:", error);
    await interaction.reply({
      content: ' There was an error executing this command.',
      flags: 64 // Ephemeral flag
    });
  }
});

// Main async startup
(async () => {
  console.log("connected to database!");
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error(" Failed to connect to database:");
    console.error(err);
    process.exit(1);
  }
})();