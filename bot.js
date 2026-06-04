import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('ok'));
app.listen(PORT, () => console.log(`Health server running on port ${PORT}`));

// Keep Render awake
setInterval(() => {
  fetch('https://shop31115154134514.onrender.com')
    .then(() => console.log('Keep-alive ping sent'))
    .catch(err => console.error('Keep-alive failed:', err.message));
}, 5 * 60 * 1000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  ADMIN_ROLE_ID,
  APPROVAL_CHANNEL_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PAYPAL_LINK = "https://paypal.com",
  VBUCKS_ACCOUNTS,
  ROBUX_STOCK = "50000"
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getVbucksStock = () => {
  if (!VBUCKS_ACCOUNTS) return [];
  return VBUCKS_ACCOUNTS.split(',').map(item => {
    const [name, balance] = item.split(':');
    return { name: name.trim(), balance: parseInt(balance) || 0 };
  });
};

const isAdmin = (interaction) => interaction.member?.roles.cache.has(ADMIN_ROLE_ID);

async function getUser(discordId) {
  let { data, error } = await supabase.from('users').select('*').eq('discord_id', discordId).single();
  if (error && error.code === 'PGRST116') {
    const { data: newUser } = await supabase.from('users').insert({ discord_id: discordId }).select().single();
    return newUser;
  }
  return data;
}

// Slash Commands
const commands = [
  { name: 'balance', description: 'Check your balance' },
  { name: 'buy', description: 'Buy V-Bucks or Robux', options: [
    { name: 'vbucks', type: 1, description: 'Buy V-Bucks' },
    { name: 'robux', type: 1, description: 'Buy Robux' }
  ]},
  { name: 'redeem', description: 'Redeem V-Bucks or Robux', options: [
    { name: 'vbucks', type: 1, description: 'Redeem V-Bucks' },
    { name: 'robux', type: 1, description: 'Redeem Robux' }
  ]},
  { name: 'history', description: 'View your last 10 transactions' },
  { name: 'addbalance', description: 'Add balance (Admin)', options: [
    { name: 'user', type: 6, description: 'User', required: true },
    { name: 'currency', type: 3, description: 'vbucks or robux', required: true, choices: [{name:'V-Bucks',value:'vbucks'}, {name:'Robux',value:'robux'}] },
    { name: 'amount', type: 4, description: 'Amount', required: true }
  ]},
  { name: 'removebalance', description: 'Remove balance (Admin)', options: [
    { name: 'user', type: 6, description: 'User', required: true },
    { name: 'currency', type: 3, description: 'vbucks or robux', required: true, choices: [{name:'V-Bucks',value:'vbucks'}, {name:'Robux',value:'robux'}] },
    { name: 'amount', type: 4, description: 'Amount', required: true }
  ]},
  { name: 'setbalance', description: 'Set balance (Admin)', options: [
    { name: 'user', type: 6, description: 'User', required: true },
    { name: 'currency', type: 3, description: 'vbucks or robux', required: true, choices: [{name:'V-Bucks',value:'vbucks'}, {name:'Robux',value:'robux'}] },
    { name: 'amount', type: 4, description: 'Amount', required: true }
  ]}
];

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error(err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

  const user = await getUser(interaction.user.id);

  // Balance Command
  if (interaction.commandName === 'balance') {
    const embed = new EmbedBuilder()
      .setColor(0x00b0f4)
      .setTitle(`${interaction.user.username}'s Balance`)
      .addFields(
        { name: 'V-Bucks', value: user.vbucks_balance.toLocaleString(), inline: true },
        { name: 'Robux', value: user.robux_balance.toLocaleString(), inline: true }
      )
      .setFooter({ text: `User ID: ${interaction.user.id}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Buy Command
  if (interaction.commandName === 'buy') {
    const sub = interaction.options.getSubcommand();
    const isVbucks = sub === 'vbucks';

    const embed = new EmbedBuilder()
      .setColor(0x00b0f4)
      .setTitle(isVbucks ? 'V-Bucks Shop' : 'Robux Shop')
      .setDescription('Select the package you want to purchase:');

    const select = new StringSelectMenuBuilder()
      .setCustomId(isVbucks ? 'vb_pack_select' : 'rb_pack_select')
      .setPlaceholder('Choose a package')
      .addOptions(isVbucks ? [
        { label: '1,000 V-Bucks — £2.10', value: '1000_2.10' },
        { label: '2,000 V-Bucks — £4.20', value: '2000_4.20' },
        { label: '5,000 V-Bucks — £10.50', value: '5000_10.50' },
        { label: '13,500 V-Bucks — £28.35', value: '13500_28.35' }
      ] : [
        { label: '1,000 Robux — £5', value: '1000_5' },
        { label: '2,000 Robux — £10', value: '2000_10' },
        { label: '5,000 Robux — £25', value: '5000_25' },
        { label: '10,000 Robux — £50', value: '10000_50' }
      ]);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // Redeem Command
  if (interaction.commandName === 'redeem') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'vbucks') {
      const accounts = getVbucksStock();
      const stockText = accounts.map(a => `${a.name}: ${a.balance.toLocaleString()} V-Bucks`).join('\n') || "No accounts available.";

      const embed = new EmbedBuilder()
        .setColor(0x00b0f4)
        .setTitle('Redeem V-Bucks')
        .setDescription(`**Current Stock:**\n${stockText}`);

      await interaction.reply({ embeds: [embed], ephemeral: true });

      const modal = new ModalBuilder().setCustomId('redeem_vb_modal').setTitle('V-Bucks Redemption');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('epic_username').setLabel('Epic Username').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_name').setLabel('Item Name').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('V-Bucks Amount').setStyle(TextInputStyle.Short).setRequired(true))
      );
      return interaction.showModal(modal);
    }

    if (sub === 'robux') {
      const stock = parseInt(ROBUX_STOCK) || 0;
      const embed = new EmbedBuilder()
        .setColor(0x00b0f4)
        .setTitle('Redeem Robux')
        .setDescription(`**Current Stock:** ${stock.toLocaleString()} Robux`);

      await interaction.reply({ embeds: [embed], ephemeral: true });

      const modal = new ModalBuilder().setCustomId('redeem_rb_modal').setTitle('Robux Redemption');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_username').setLabel('Roblox Username').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Robux Amount').setStyle(TextInputStyle.Short).setRequired(true))
      );
      return interaction.showModal(modal);
    }
  }

  // History Command
  if (interaction.commandName === 'history') {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Recent Transactions')
      .setDescription('Last 10 transactions will appear here.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Admin Commands (simplified)
  if (['addbalance', 'removebalance', 'setbalance'].includes(interaction.commandName)) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Admin only.', ephemeral: true });
    // Add your admin logic here if needed
    return interaction.reply({ content: 'Command executed.', ephemeral: true });
  }

  // Select Menu Handler (Pack Selection → Payment)
  if (interaction.isStringSelectMenu()) {
    const [amount, price] = interaction.values[0].split('_');
    const isVbucks = interaction.customId.startsWith('vb');

    const embed = new EmbedBuilder()
      .setColor(0x00b0f4)
      .setTitle(`Purchase ${amount} ${isVbucks ? 'V-Bucks' : 'Robux'}`)
      .setDescription(`**Price:** £${price}\n\nPlease select your payment method:`);

    const paymentOptions = isVbucks 
      ? [
          { label: 'PayPal', value: `paypal_${amount}` },
          { label: '£10 Roblox Gift Card', value: `giftcard_${amount}` }
        ]
      : [{ label: 'PayPal', value: `paypal_${amount}` }];

    const select = new StringSelectMenuBuilder()
      .setCustomId(`payment_select_${isVbucks ? 'vb' : 'rb'}_${amount}`)
      .setPlaceholder('Choose Payment Method')
      .addOptions(paymentOptions);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.update({ embeds: [embed], components: [row] });
  }
});

client.login(DISCORD_TOKEN);
