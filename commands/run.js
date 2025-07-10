const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('run')
    .setDescription('Bot confirms it is online'),
  async execute(interaction) {
    await interaction.reply('bot and database are online');
  }
};
