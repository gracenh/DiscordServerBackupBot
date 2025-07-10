
/**  Note: This command is intended to be used in a Discord bot context and requires the Discord.js library to function properly
/* Make sure to have the necessary permissions and intents enabled for your bot.
/* Some varaiables have hardcoded values that need to be set before running your bot, such as the archive guild ID
/*
/* i apologize for the code being pretty messy! it was originally meant for personal use
*/

/**
 * @file scrape.js
 * @description This command archives messages from the current channel to a backup server.
 * @author grace
 * @requires Discord.js v14+
 * @requires Node.js v16.6.0 or higher
 * @requires dotenv (for environment variables)
 */


const { SlashCommandBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const BATCH_SIZE = 100;
const BATCH_DELAY = 1000;
const CHUNK_SIZE = 25000;
const PROGRESS_UPDATE_INTERVAL = 50000;
const PROGRESS_SAVE_INTERVAL = 10000;
const MAX_RUNTIME = 25 * 60 * 1000;

//OPTIONAL: If you want to start from a specific message ID, set it here
const HARDCODED_START_MESSAGE_ID = null; 

function splitContent(content, maxLen = MAX_MESSAGE_LENGTH) {
  const chunks = [];
  while (content.length > maxLen) {
    let idx = content.lastIndexOf('\n', maxLen);
    if (idx === -1) idx = content.lastIndexOf(' ', maxLen);
    if (idx === -1) idx = maxLen;
    chunks.push(content.slice(0, idx));
    content = content.slice(idx).trimStart();
  }
  chunks.push(content);
  return chunks;
}


//find oldest message in a channel
async function findOldestMessage(channel) {
  let oldestMessage = null;
  let lastId = null;
  let requestCount = 0;
  //limit to prevent an infinite loop
  const MAX_REQUESTS = 100; 
  
  
  try {
    await channel.send(' Searching for oldest message...');
    
    //keep fetching backwards until it can't get any more messages
    while (requestCount < MAX_REQUESTS) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      
      const messages = await channel.messages.fetch(options);
      if (messages.size === 0) break;
      
      //update oldest message to the last message in this batch
      oldestMessage = messages.last();
      lastId = oldestMessage.id;
      requestCount++;
      
      //show progress every 20 requests
      if (requestCount % 20 === 0) {
        await channel.send(`Still searching... (${requestCount * 100} messages checked)`);
      }
      
      // Add a delay to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    }
    
    if (requestCount >= MAX_REQUESTS) {
      await channel.send(`Reached search limit (${MAX_REQUESTS * 100} messages). Starting from oldest found.`);
    }
  } catch (error) {
    console.error('Error finding oldest message:', error);
    await channel.send('Error while searching for oldest message. Starting from newest available.');
  }
  
  return oldestMessage;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scrape')
    .setDescription("Archive the current channel's messages to the backup server")
    .addStringOption(option =>
      option.setName('start_method')
        .setDescription('How to start the scraping')
        .setRequired(false)
        .addChoices(
          { name: 'Find oldest message automatically', value: 'auto' },
          { name: 'Start from specific message ID', value: 'manual' }
        )
    )
    .addStringOption(option =>
      option.setName('message_id')
        .setDescription('Message ID to start from (only if using manual start)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const source = interaction.channel;
    const startMethod = interaction.options.getString('start_method');
    const messageId = interaction.options.getString('message_id');
    
    //for debugging: Log what options were received 
    console.log('Scrape options:', { startMethod, messageId });
    
    //ensure global states exist
    if (!global.scrapingState) {
      global.scrapingState = {
        isActive: false,
        channelId: null,
        processedCount: 0,
        shouldStop: false
      };
    }
    
    //check if already scraping
    if (global.scrapingState.isActive) {
      return interaction.reply('A scraping operation is already in progress. Use `/stop` to halt it first.');
    }
    
    // Initialize global state
    global.scrapingState.isActive = true;
    global.scrapingState.channelId = source.id;
    global.scrapingState.processedCount = 0;
    global.scrapingState.shouldStop = false;
    
    await interaction.reply(`Starting to scrape #${source.name}… this may take a while.`);

    try {
      //connect to archive guild
      const archiveGuildId = 'SET YOUR ARCHIVE GUILD ID HERE'; 
      let archiveGuild;
      try {
        archiveGuild = await interaction.client.guilds.fetch(archiveGuildId);
      } catch (err) {
        console.error('Could not fetch archive guild:', err);
        return interaction.channel.send(' Could not access archive server.');
      }

      //creates category if it doesn't exist, if it does creates a channel in that category
      let archiveCategory = null;
      if (source.parent?.type === ChannelType.GuildCategory) {
        const catName = source.parent.name;
        archiveCategory =
          archiveGuild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === catName)
          ?? await archiveGuild.channels.create({ name: catName, type: ChannelType.GuildCategory });
      }

      // 3Ensure archive channel
      const chanName = source.name;
      let archiveChan =
        archiveGuild.channels.cache.find(ch =>
          ch.type === ChannelType.GuildText &&
          ch.name === chanName &&
          (archiveCategory ? ch.parentId === archiveCategory.id : !ch.parent)
        );

      let totalArchived = 0;
      let resumeFromId = null;
      let isResume = false;

      if (!archiveChan) {
        // first-ever run: create fresh
        archiveChan = await archiveGuild.channels.create({
          name: chanName,
          type: ChannelType.GuildText,
          parent: archiveCategory?.id
        });
        await interaction.channel.send(' Created new archive channel; starting from the oldest message.');
      } else {
        // already exists: fetch its most recent message to find resume point
        const fetched = await archiveChan.messages.fetch({ limit: 50 });
        let lastArchivedMessageId = null;
        let lastProgressCount = 0;

        //look through recent messages to find the last actual archived message (not progress messages)
        for (const msg of fetched.values()) {
          //Skip bots own progress messages
          if (msg.content.includes('Progress saved at message ID:') || 
              msg.content.includes('messages processed') ||
              msg.content.includes('Processing chunk') ||
              msg.content.includes('Finished chunk')) {
            //Extract count from progress messages
            const countMatch = msg.content.match(/\((\d+) messages processed\)/);
            if (countMatch && parseInt(countMatch[1]) > lastProgressCount) {
              lastProgressCount = parseInt(countMatch[1]);
            }
            continue;
          }

          //look for actual archived messages with Message ID
          const idMatch = msg.content.match(/\(Message ID: (\d+)\):/);
          if (idMatch) {
            lastArchivedMessageId = idMatch[1];
            break; //this is the most recent archived message
          }
        }

        if (lastArchivedMessageId) {
          //Check if this message still exists in the source channel
          try {
            await source.messages.fetch(lastArchivedMessageId);
            resumeFromId = lastArchivedMessageId;
            totalArchived = lastProgressCount;
            isResume = true;
            await interaction.channel.send(`Resuming from Message ID: ${resumeFromId} (${totalArchived} messages already processed)`);
          } catch (err) {
            //message was deleted, start fresh but keep the archive channel
            await interaction.channel.send(' Last archived message no longer exists in source. Starting fresh but keeping existing archive.');
            resumeFromId = null;
            totalArchived = 0;
          }
        } else {
          await interaction.channel.send(' Archive channel found but no valid resume point found—starting from oldest.');
          resumeFromId = null;
          totalArchived = 0;
        }
      }

      // helper to save progress
      const save = async (lastId, count) => {
        if (!lastId) return;
        try {
          await archiveChan.send(`Progress saved at message ID: ${lastId} (${count} messages processed)`);
        } catch (err) {
          console.error('Failed to save progress:', err);
        }
      };

      //  Start streaming from source channel
      let lastId = null; //start from newest when resuming, or null for full scrape
      let processedCount = totalArchived;
      let lastProcessedId = null;
      const startTime = Date.now();
      await interaction.channel.send('Beginning streaming…');

      //check for manual message ID first (takes priority over resume)
      if (startMethod === 'manual' && messageId) {
        //use provided message ID
        try {
          const startMessage = await source.messages.fetch(messageId);
          lastId = messageId;
          await interaction.channel.send(`Starting from provided message ID: ${messageId} (from ${startMessage.createdAt.toISOString().split('T')[0]})`);
        } catch (err) {
          await interaction.channel.send(`Error: Could not fetch message ID ${messageId}. Make sure the message exists in this channel.`);
          return;
        }
      } else if (isResume && resumeFromId) {
        //if resuming,  find new messages after our last archived message
        lastId = null; // Start from newest
      } else if (startMethod === 'auto' || !startMethod) {
        //find oldest message automatically
        await interaction.channel.send('Finding oldest message in channel...');
        const oldestMessage = await findOldestMessage(source);
        if (oldestMessage) {
          lastId = oldestMessage.id;
          await interaction.channel.send(`Found oldest message from ${oldestMessage.createdAt.toISOString().split('T')[0]}. Starting scrape from the beginning.`);
        } else {
          await interaction.channel.send('Could not find oldest message, starting from newest available.');
          lastId = null;
        }
      } else {
        //no method specified, ask user
        await interaction.channel.send('Please specify a start method: `/scrape start_method:auto` to find oldest message, or `/scrape start_method:manual message_id:1234567890123456789` to start from a specific message.');
        return;
      }

      let chunkNum = 0;
      let newMessagesFound = 0;
      
      while (true) {
        //check for stop request
        if (global.scrapingState.shouldStop) {
          await interaction.channel.send(' Scraping stopped by user request.');
          await save(lastProcessedId, processedCount);
          break;
        }
        
        // timeout guard to prevent discord timeouts
        if (Date.now() - startTime > MAX_RUNTIME) {
          await interaction.channel.send('⏱️Timeout reached—save and rerun to continue.');
          await save(lastProcessedId, processedCount);
          break;
        }

        // fetch up to CHUNK_SIZE in batches
        const chunk = [];
        while (chunk.length < CHUNK_SIZE) {
          try {
            const opts = { limit: BATCH_SIZE };
            if (lastId) {
              // If it has a lastId, fetch messages after it (forwards in time)
              opts.after = lastId;
            }
            const batch = await source.messages.fetch(opts);
            if (!batch.size) break;
            
            console.log(`Fetched batch: ${batch.size} messages, chunk so far: ${chunk.length}`);
            
            let foundResumePoint = false;
            for (const m of batch.values()) {
              if (m.system) continue;
              
              // if resuming, check if it has reached the last archived message
              if (isResume && resumeFromId && m.id === resumeFromId) {
                foundResumePoint = true;
                break; //break loop to stop fetching
              }
              
              chunk.push(m);
            }
            
            //update lastId to the newest message in this batch
            lastId = batch.first().id;
            
            //if resume point was found, break out of the loop
            if (foundResumePoint) {
              break;
            }
            
            await new Promise(r => setTimeout(r, BATCH_DELAY));
            if (batch.size < BATCH_SIZE) break;
          } catch (e) {
            console.error('Fetch error:', e);
            await interaction.channel.send('Fetch error—retrying in 5s…');
            await new Promise(r => setTimeout(r, 5000));
          }
        }
        
        if (!chunk.length) {
          if (newMessagesFound === 0 && isResume) {
            await interaction.channel.send('No new messages found since last archive.');
          }
          break;
        }

        //process chunk in chronological order 
        newMessagesFound += chunk.length;
        
        console.log(`Final chunk size: ${chunk.length} messages`);
        
        //only show chunk processing for smaller chunks or first few chunks
        if (chunk.length < 10000 || chunkNum < 3) {
          await interaction.channel.send(` Processing chunk ${chunkNum+1}: ${chunk.length} messages`);
        }

        //check for stop request before processing chunk
        if (global.scrapingState.shouldStop) {
          await interaction.channel.send(' Scraping stopped by user request.');
          await save(lastProcessedId, processedCount);
          break;
        }

        // send each message
        for (const msg of chunk) {
          const ts = msg.createdAt.toISOString().replace('T',' ').split('.')[0];
          const header = `${msg.author.bot ? '[BOT] ' : ''}${msg.author.username} (${msg.author.id}) [${ts}] (Message ID: ${msg.id}):`;
          const pieces = splitContent(`${header}\n${msg.content||''}`);
          const files = [];
          for (const att of msg.attachments.values()) {
            if (att.size <= MAX_FILE_SIZE) files.push(new AttachmentBuilder(att.url, { name: att.name }));
          }

          try {
            for (let i = 0; i < pieces.length; i++) {
              //check for stop request before each message
              if (global.scrapingState.shouldStop) {
                await interaction.channel.send('Scraping stopped by user request.');
                await save(lastProcessedId, processedCount);
                return;
              }
              
              await archiveChan.send({
                content: pieces[i],
                files: i === pieces.length-1 ? files : []
              });
              processedCount++;
              global.scrapingState.processedCount = processedCount; // Update global state
              lastProcessedId = msg.id;
              if (processedCount % PROGRESS_UPDATE_INTERVAL === 0)
                await interaction.channel.send(`Archived ${processedCount} messages so far…`);
              if (processedCount % PROGRESS_SAVE_INTERVAL === 0)
                await save(lastProcessedId, processedCount);
              await new Promise(r => setTimeout(r, 200));
            }
          } catch (err) {
            if (err.code === 429) {
              const waitMs = (err.retryAfter||900)*1000;
              await interaction.channel.send(`⏳ Rate limit hit—waiting ${Math.ceil(waitMs/60000)}m…`);
              await save(lastProcessedId, processedCount);
              await new Promise(r => setTimeout(r, waitMs));
            } else {
              console.error('Send error:', err);
              await interaction.followUp(' Fatal error—saving progress and aborting.');
              await save(lastProcessedId, processedCount);
              return;
            }
          }
        }

        chunkNum++;
        //only show finished chunk message for smaller chunks or first few chunks
        if (chunk.length < 10000 || chunkNum <= 3) {
          await interaction.followUp(` Finished chunk ${chunkNum}: ${chunk.length} messages`);
        }
        await save(lastProcessedId, processedCount);
        
        //if we were resuming and found messages, we're done with the new messages
        if (isResume) break;
      }

      await save(lastProcessedId, processedCount);
      
      //check if stopped before final message
      const wasStopped = global.scrapingState.shouldStop;
      
      if (wasStopped) {
        await interaction.followUp(`Scraping stopped. Total archived: ${processedCount} messages`);
      } else {
        await interaction.followUp(`Scrape complete! Total archived: ${processedCount} messages`);
      }
    } finally {
      //clean up global state - this will always run
      global.scrapingState.isActive = false;
      global.scrapingState.channelId = null;
      global.scrapingState.processedCount = 0;
      global.scrapingState.shouldStop = false;
    }
  }
};
