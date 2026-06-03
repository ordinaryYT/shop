import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Health check + Render keep-alive
app.get('/', (req, res) => res.send('ok'));
app.listen(PORT, () => console.log(`Health server running on port ${PORT}`));

// Keep Render awake
setInterval(async () => {
  try {
    await fetch('https://shop31115154134514.onrender.com');
    console.log('Keep-alive ping sent');
  } catch (err) {
    console.error('Keep-alive ping failed:', err.message);
  }
}, 5 * 60 * 1000); // Every 5 minutes

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

// Parse V-Bucks Accounts
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

// Commands
const commands = [
  { name: 'balance', description: 'Check your V-Bucks and Robux balance' },
  { name: 'buy', description: 'Buy V-Bucks or Robux',
    options: [
      { name: 'vbucks', type: 1, description: 'Buy V-Bucks packs' },
      { name: 'robux', type: 1, description: 'Buy Robux packs' }
    ]
  },
  { name: 'redeem', description: 'Redeem V-Bucks or Robux',
    options: [
      { name: 'vbucks', type: 1, description: 'Redeem V-Bucks to your Epic account' },
      { name: 'robux', type: 1, description: 'Redeem Robux to your Roblox account' }
    ]
  },
  { name: 'history', description: 'View your last 10 transactions' },
  { name: 'addbalance', description: 'Add balance to a user (Admin)',
    options: [
      { name: 'user', type: 6, description: 'The user', required: true },
      { name: 'currency', type: 3, description: 'vbucks or robux', required: true, choices: [{name:'V-Bucks',value:'vbucks'}, {name:'Robux',value:'robux'}] },
      { name: 'amount', type: 4, description: 'Amount to add', required: true }
    ]
  },
  { name: 'removebalance', description: 'Remove balance from a user (Admin)',
    options: [
      { name: 'user', type: 6, description: 'The user', required: true },
      { name: 'currency', type: 3, description: 'vbucks or robux', required: true, choices: [{name:'V-Bucks',value:'vbucks'}, {name:'Robux',value:'robux'}] },
      { name: 'amount', type: 4, description: 'Amount to remove', required: true }
    ]
  },
  { name: 'setbalance', description: 'Set exact balance for a user (Admin)',
    options: [
      { name: 'user', type: 6, description: 'The user', required: true },
      { name: 'currency', type: 3, description: 'vbucks or robux', required: true, choices: [{name:'V-Bucks',value:'vbucks'}, {name:'Robux',value:'robux'}] },
      { name: 'amount', type: 4, description: 'New balance', required: true }
    ]
  }
];

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
    console.log('Slash commands registered successfully.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

  const user = await getUser(interaction.user.id);

  if (interaction.isCommand()) {
    const { commandName } = interaction;

    if (commandName === 'balance') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('Your Balance')
          .addFields(
            { name: 'V-Bucks', value: user.vbucks_balance.toLocaleString(), inline: true },
            { name: 'Robux', value: user.robux_balance.toLocaleString(), inline: true }
          )
        ],
        ephemeral: true
      });
    }

    if (commandName === 'history') {
      const { data: orders } = await supabase.from('orders').select('*').eq('discord_id', interaction.user.id).order('created_at', { ascending: false }).limit(10);
      const { data: redemptions } = await supabase.from('redemptions').select('*').eq('discord_id', interaction.user.id).order('created_at', { ascending: false }).limit(10);

      const embed = new EmbedBuilder().setTitle('Recent Transactions').setColor(0x0099ff);
      orders?.forEach(o => embed.addFields({ name: `${o.currency.toUpperCase()} Purchase`, value: `${o.amount} - ${o.status}`, inline: true }));
      redemptions?.forEach(r => embed.addFields({ name: `${r.currency.toUpperCase()} Redemption`, value: `${r.amount} - ${r.status}`, inline: true }));

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Buy Command
    if (commandName === 'buy') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'vbucks') {
        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('buy_vb_1000').setLabel('1,000 V-Bucks (2.10)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_vb_2000').setLabel('2,000 V-Bucks (4.20)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_vb_5000').setLabel('5,000 V-Bucks (10.50)').setStyle(ButtonStyle.Primary)
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('buy_vb_13500').setLabel('13,500 V-Bucks (28.35)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('pay_paypal_vb').setLabel('PayPal').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('pay_giftcard_vb').setLabel('10 Gift Card').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({ content: 'Select V-Bucks Pack', components: [row1, row2], ephemeral: true });
      }
      if (sub === 'robux') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('buy_rb_1000').setLabel('1,000 Robux (5)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_rb_2000').setLabel('2,000 Robux (10)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_rb_5000').setLabel('5,000 Robux (25)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_rb_10000').setLabel('10,000 Robux (50)').setStyle(ButtonStyle.Primary)
        );
        return interaction.reply({ content: 'Select Robux Pack (PayPal Only)', components: [row], ephemeral: true });
      }
    }

    // Redeem Command
    if (commandName === 'redeem') {
      const sub = interaction.options.getSubcommand();

      if (sub === 'vbucks') {
        const accounts = getVbucksStock();
        let stockText = accounts.map(a => `${a.name} - ${a.balance.toLocaleString()} V-Bucks`).join('\n') || "No accounts configured.";
        await interaction.reply({ content: `Current V-Bucks Stock:\n${stockText}\n\nIf low, create a ticket.`, ephemeral: true });

        const modal = new ModalBuilder().setCustomId('modal_redeem_vb').setTitle('Redeem V-Bucks');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('epic_username').setLabel('Epic Username').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_name').setLabel('Item Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('V-Bucks Amount').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (sub === 'robux') {
        const stock = parseInt(ROBUX_STOCK) || 0;
        await interaction.reply({ content: `Current Robux Stock: ${stock.toLocaleString()}\n\nIf not enough, create a ticket.`, ephemeral: true });

        const modal = new ModalBuilder().setCustomId('modal_redeem_rb').setTitle('Redeem Robux');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_username').setLabel('Roblox Username').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Robux Amount').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }
    }

    // Admin Commands
    if (['addbalance', 'removebalance', 'setbalance'].includes(commandName)) {
      if (!isAdmin(interaction)) return interaction.reply({ content: 'Admin only!', ephemeral: true });

      const target = interaction.options.getUser('user');
      const currency = interaction.options.getString('currency');
      const amount = interaction.options.getInteger('amount');

      let newBalance = amount;
      if (commandName === 'addbalance') newBalance = user[`${currency}_balance`] + amount;
      if (commandName === 'removebalance') newBalance = Math.max(0, user[`${currency}_balance`] - amount);

      await supabase.from('users').update({ [`${currency}_balance`]: newBalance }).eq('discord_id', target.id);
      return interaction.reply({ content: `Success!`, ephemeral: true });
    }
  }

  // Modals
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'modal_redeem_vb') {
      const epic = interaction.fields.getTextInputValue('epic_username');
      const item = interaction.fields.getTextInputValue('item_name');
      const amount = parseInt(interaction.fields.getTextInputValue('amount'));

      if (!amount || amount <= 0) return interaction.reply({ content: "Invalid amount!", ephemeral: true });

      const { data } = await supabase.from('redemptions').insert({
        discord_id: interaction.user.id,
        currency: 'vbucks',
        amount,
        username: epic,
        item,
        status: 'pending'
      }).select().single();

      const embed = new EmbedBuilder().setTitle('V-Bucks Redemption Request').setColor(0xffaa00)
        .addFields(
          { name: 'User', value: `<@${interaction.user.id}>` },
          { name: 'Epic Username', value: epic },
          { name: 'Item', value: item },
          { name: 'Amount', value: amount.toLocaleString() }
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_red_vb_${data.id}`).setLabel('Sent').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_red_vb_${data.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
      );

      const msg = await client.channels.cache.get(APPROVAL_CHANNEL_ID).send({ embeds: [embed], components: [row] });
      await supabase.from('redemptions').update({ approval_msg_id: msg.id }).eq('id', data.id);

      return interaction.reply({ content: 'Redemption request sent for approval!', ephemeral: true });
    }

    if (interaction.customId === 'modal_redeem_rb') {
      const robloxUser = interaction.fields.getTextInputValue('roblox_username');
      const amount = parseInt(interaction.fields.getTextInputValue('amount'));

      if (!amount || amount <= 0) return interaction.reply({ content: "Invalid amount!", ephemeral: true });

      const { data } = await supabase.from('redemptions').insert({
        discord_id: interaction.user.id,
        currency: 'robux',
        amount,
        username: robloxUser,
        status: 'pending'
      }).select().single();

      const embed = new EmbedBuilder().setTitle('Robux Redemption Request').setColor(0xffaa00)
        .addFields(
          { name: 'User', value: `<@${interaction.user.id}>` },
          { name: 'Roblox Username', value: robloxUser },
          { name: 'Amount', value: amount.toLocaleString() }
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_red_rb_${data.id}`).setLabel('Sent').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_red_rb_${data.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
      );

      const msg = await client.channels.cache.get(APPROVAL_CHANNEL_ID).send({ embeds: [embed], components: [row] });
      await supabase.from('redemptions').update({ approval_msg_id: msg.id }).eq('id', data.id);

      return interaction.reply({ content: 'Redemption request sent for approval!', ephemeral: true });
    }
  }

  // Buttons
  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith('approve_') || customId.startsWith('reject_')) {
      if (!isAdmin(interaction)) return interaction.reply({ content: 'Admin only!', ephemeral: true });

      const [action, type, subtype, id] = customId.split('_');
      const isRedemption = type === 'red';
      const table = isRedemption ? 'redemptions' : 'orders';

      const { data: record } = await supabase.from(table).select('*').eq('id', id).single();

      if (action === 'approve') {
        const currency = record.currency;
        const change = isRedemption ? -record.amount : record.amount;
        const newBalance = (user[`${currency}_balance`] || 0) + change;

        await supabase.from('users').update({ [`${currency}_balance`]: Math.max(0, newBalance) })
          .eq('discord_id', record.discord_id);
      }

      await supabase.from(table).update({
        status: action === 'approve' ? 'approved' : 'rejected',
        actioned_by: interaction.user.id,
        actioned_at: new Date().toISOString()
      }).eq('id', id);

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(action === 'approve' ? 0x00ff00 : 0xff0000)
        .setFooter({ text: `${action.toUpperCase()} by ${interaction.user.tag}` });

      await interaction.update({ embeds: [embed], components: [] });
    }
  }
});

client.login(DISCORD_TOKEN);
