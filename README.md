# Basic Server Backup Bot

This is a simple discord backup server bot, it takes messages of a server and replicates the category, channel, and messages. Meant to prevent total server loss if owner or admin accounts are compromised maliciously.

## Requirements
1. Discordjs
2. node.js


## Getting Started

1. Clone the repository
2. Run `npm install` to install dependencies
3. Update `.env` and update `config.json` with appropriate values
4. Run the bot:

## To run
1. Open command prompt or terminal of hosting service
2. Go to the directory of the folder
3. type  `node deploy-commands.js` (run this command anytime you create a new command file)
4. run:  `node index.js`

## Things to know
- This bot was originally created for a one-time use of a server backup. It is fairly messy code
- The bot currently only has the /scrape command, and it does not handle large channels well (200k+ messages). Meant to be used in smaller community servers
- I do plan to keep working on it. Feel free to fork or push PRs if you have improvements
- Feel free to contact me with any questions. Discord: patrickthatsapickle
