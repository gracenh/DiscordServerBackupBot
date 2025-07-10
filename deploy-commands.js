const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const config = require('./config.json');

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Deploying slash commands...');

    for (const guildId of config.guildIds) {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, guildId),
        { body: commands }
      );
      console.log(`✅ Slash commands deployed to guild ${guildId}`);
    }

  } catch (error) {
    console.error("❌ Error deploying commands:", error);
  }
})();
