import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';

// ---------- env ----------
const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  ADMIN_ROLE_ID,
  APPROVAL_CHANNEL_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PAYPAL_LINK = 'coming-soon',
  PORT = 3000,
} = process.env;

function need(name, v) {
  if (!v) console.warn(`[warn] missing env var ${name}`);
}
for (const [k, v] of Object.entries({
  DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, ADMIN_ROLE_ID,
  APPROVAL_CHANNEL_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
})) need(k, v);

// ---------- express keepalive ----------
const app = express();
app.get('/', (_req, res) => res.send('ok'));
app.listen(PORT, () => console.log(`[http] listening on ${PORT}`));

// ---------- supabase ----------
const sb = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

async function getUser(discord_id) {
  if (!sb) return { discord_id, vbucks_balance: 0, robux_balance: 0 };
  const { data } = await sb.from('users').select('*').eq('discord_id', discord_id).maybeSingle();
  if (data) return data;
  const { data: ins } = await sb.from('users').insert({ discord_id }).select('*').single();
  return ins;
}

async function adjustBalance(discord_id, currency, delta) {
  const u = await getUser(discord_id);
  const col = currency === 'vbucks' ? 'vbucks_balance' : 'robux_balance';
  const next = Math.max(0, (u[col] || 0) + delta);
  await sb.from('users').update({ [col]: next, updated_at: new Date().toISOString() }).eq('discord_id', discord_id);
  return next;
}

async function setBalance(discord_id, currency, value) {
  await getUser(discord_id);
  const col = currency === 'vbucks' ? 'vbucks_balance' : 'robux_balance';
  await sb.from('users').update({ [col]: Math.max(0, value), updated_at: new Date().toISOString() }).eq('discord_id', discord_id);
}

// ---------- pricing ----------
const VBUCKS_PACKS = [1000, 2000, 5000, 13500];
const ROBUX_PACKS = [1000, 2000, 5000, 10000];
const PRICE_PER_1K_VBUCKS = 2.10;
const PRICE_PER_1K_ROBUX = 5.00;
const GIFTCARD_VBUCKS = 2000;

const fmtGBP = n => `£${Number(n).toFixed(2)}`;

// ---------- slash commands ----------
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Show your V-Bucks and Robux balance'),
  new SlashCommandBuilder().setName('buy').setDescription('Buy currency')
    .addSubcommand(s => s.setName('vbucks').setDescription('Buy V-Bucks'))
    .addSubcommand(s => s.setName('robux').setDescription('Buy Robux')),
  new SlashCommandBuilder().setName('redeem').setDescription('Redeem from your balance')
    .addSubcommand(s => s.setName('vbucks').setDescription('Redeem V-Bucks on an item'))
    .addSubcommand(s => s.setName('robux').setDescription('Redeem Robux')),
  new SlashCommandBuilder().setName('history').setDescription('Show your last 10 transactions'),
  new SlashCommandBuilder().setName('addbalance').setDescription('Admin: add balance to a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('currency').setDescription('vbucks or robux').setRequired(true)
      .addChoices({ name: 'vbucks', value: 'vbucks' }, { name: 'robux', value: 'robux' }))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
  new SlashCommandBuilder().setName('removebalance').setDescription('Admin: remove balance from a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('currency').setDescription('vbucks or robux').setRequired(true)
      .addChoices({ name: 'vbucks', value: 'vbucks' }, { name: 'robux', value: 'robux' }))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
  new SlashCommandBuilder().setName('setbalance').setDescription('Admin: set a user balance')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('currency').setDescription('vbucks or robux').setRequired(true)
      .addChoices({ name: 'vbucks', value: 'vbucks' }, { name: 'robux', value: 'robux' }))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
].map(c => c.toJSON());

async function registerCommands() {
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    console.warn('[warn] skipping command registration — missing env');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
  console.log('[discord] commands registered');
}

// ---------- client ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => console.log(`[discord] logged in as ${client.user.tag}`));

function isAdmin(member) {
  if (!member) return false;
  if (ADMIN_ROLE_ID && member.roles?.cache?.has(ADMIN_ROLE_ID)) return true;
  return !!member.permissions?.has(PermissionFlagsBits.Administrator);
}

async function ephem(i, content) {
  return i.reply({ content, flags: MessageFlags.Ephemeral });
}

// ---------- approval channel post helpers ----------
async function postOrderApproval(order, userTag) {
  const ch = await client.channels.fetch(APPROVAL_CHANNEL_ID);
  const embed = new EmbedBuilder()
    .setTitle(`🛒 New ${order.currency.toUpperCase()} order — pending`)
    .setColor(0xf1c40f)
    .addFields(
      { name: 'User', value: `<@${order.discord_id}> (${userTag})`, inline: true },
      { name: 'Amount', value: `${order.amount.toLocaleString()} ${order.currency}`, inline: true },
      { name: 'Price', value: fmtGBP(order.price_gbp), inline: true },
      { name: 'Payment', value: order.payment_method, inline: true },
      { name: 'Order ID', value: `\`${order.id}\`` },
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order:approve:${order.id}`).setLabel('✅ Payment Received').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`order:reject:${order.id}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger),
  );
  const msg = await ch.send({ embeds: [embed], components: [row] });
  await sb.from('orders').update({ approval_msg_id: msg.id }).eq('id', order.id);
}

async function postRedemptionApproval(r, userTag) {
  const ch = await client.channels.fetch(APPROVAL_CHANNEL_ID);
  const embed = new EmbedBuilder()
    .setTitle(`🎁 New ${r.currency.toUpperCase()} redemption — pending`)
    .setColor(0x3498db)
    .addFields(
      { name: 'User', value: `<@${r.discord_id}> (${userTag})`, inline: true },
      { name: r.currency === 'vbucks' ? 'Epic Username' : 'Roblox Username', value: r.username, inline: true },
      { name: 'Amount', value: `${r.amount.toLocaleString()} ${r.currency}`, inline: true },
      ...(r.item ? [{ name: 'Item', value: r.item }] : []),
      { name: 'Redemption ID', value: `\`${r.id}\`` },
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`redeem:approve:${r.id}`).setLabel('✅ Sent / Remove Balance').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`redeem:reject:${r.id}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger),
  );
  const msg = await ch.send({ embeds: [embed], components: [row] });
  await sb.from('redemptions').update({ approval_msg_id: msg.id }).eq('id', r.id);
}

// ---------- interactions ----------
client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) return handleCommand(i);
    if (i.isButton()) return handleButton(i);
    if (i.isStringSelectMenu()) return handleSelect(i);
    if (i.isModalSubmit()) return handleModal(i);
  } catch (e) {
    console.error(e);
    if (i.isRepliable() && !i.replied && !i.deferred) {
      try { await ephem(i, `Error: ${e.message || e}`); } catch {}
    }
  }
});

async function handleCommand(i) {
  const name = i.commandName;

  if (name === 'balance') {
    const u = await getUser(i.user.id);
    return ephem(i, `**Your balance**\n• V-Bucks: ${u.vbucks_balance.toLocaleString()}\n• Robux: ${u.robux_balance.toLocaleString()}`);
  }

  if (name === 'buy') {
    const sub = i.options.getSubcommand();
    if (sub === 'vbucks') {
      const row = new ActionRowBuilder().addComponents(
        ...VBUCKS_PACKS.map(a => new ButtonBuilder()
          .setCustomId(`buy:vbucks:pack:${a}`)
          .setLabel(`${a.toLocaleString()} — ${fmtGBP((a / 1000) * PRICE_PER_1K_VBUCKS)}`)
          .setStyle(ButtonStyle.Primary)),
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('buy:vbucks:giftcard').setLabel(`🎟️ £10 Roblox Gift Card → ${GIFTCARD_VBUCKS} V-Bucks`).setStyle(ButtonStyle.Secondary),
      );
      return i.reply({ content: '**Buy V-Bucks** — pick a pack:', components: [row, row2], flags: MessageFlags.Ephemeral });
    }
    if (sub === 'robux') {
      const row = new ActionRowBuilder().addComponents(
        ...ROBUX_PACKS.map(a => new ButtonBuilder()
          .setCustomId(`buy:robux:pack:${a}`)
          .setLabel(`${a.toLocaleString()} — ${fmtGBP((a / 1000) * PRICE_PER_1K_ROBUX)}`)
          .setStyle(ButtonStyle.Primary)),
      );
      return i.reply({ content: '**Buy Robux** — pick a pack (PayPal):', components: [row], flags: MessageFlags.Ephemeral });
    }
  }

  if (name === 'redeem') {
    const sub = i.options.getSubcommand();
    const u = await getUser(i.user.id);
    if (sub === 'vbucks') {
      if (u.vbucks_balance <= 0) return ephem(i, 'You have no V-Bucks balance.');
      const modal = new ModalBuilder().setCustomId('modal:redeem:vbucks').setTitle('Redeem V-Bucks')
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('epic').setLabel('Epic Games Username').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item').setLabel('Item Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel(`Price in V-Bucks (you have ${u.vbucks_balance})`).setStyle(TextInputStyle.Short).setRequired(true)),
        );
      return i.showModal(modal);
    }
    if (sub === 'robux') {
      if (u.robux_balance <= 0) return ephem(i, 'You have no Robux balance.');
      const modal = new ModalBuilder().setCustomId('modal:redeem:robux').setTitle('Redeem Robux')
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user').setLabel('Roblox Username').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel(`Amount of Robux (you have ${u.robux_balance})`).setStyle(TextInputStyle.Short).setRequired(true)),
        );
      return i.showModal(modal);
    }
  }

  if (name === 'history') {
    const [{ data: orders = [] }, { data: reds = [] }] = await Promise.all([
      sb.from('orders').select('*').eq('discord_id', i.user.id).order('created_at', { ascending: false }).limit(10),
      sb.from('redemptions').select('*').eq('discord_id', i.user.id).order('created_at', { ascending: false }).limit(10),
    ]);
    const lines = [
      '**Recent orders**',
      ...(orders.length ? orders.map(o => `• ${new Date(o.created_at).toLocaleDateString()} — ${o.amount} ${o.currency} (${o.payment_method}) — ${o.status}`) : ['_none_']),
      '',
      '**Recent redemptions**',
      ...(reds.length ? reds.map(r => `• ${new Date(r.created_at).toLocaleDateString()} — ${r.amount} ${r.currency} → ${r.username} — ${r.status}`) : ['_none_']),
    ];
    return ephem(i, lines.join('\n'));
  }

  if (['addbalance', 'removebalance', 'setbalance'].includes(name)) {
    if (!isAdmin(i.member)) return ephem(i, 'Admins only.');
    const target = i.options.getUser('user');
    const currency = i.options.getString('currency');
    const amount = i.options.getInteger('amount');
    if (amount < 0) return ephem(i, 'Amount must be ≥ 0.');
    await getUser(target.id);
    if (name === 'addbalance') await adjustBalance(target.id, currency, amount);
    else if (name === 'removebalance') await adjustBalance(target.id, currency, -amount);
    else await setBalance(target.id, currency, amount);
    const u = await getUser(target.id);
    const col = currency === 'vbucks' ? u.vbucks_balance : u.robux_balance;
    return ephem(i, `✅ ${target.tag} ${currency} balance is now **${col.toLocaleString()}**.`);
  }
}

async function handleButton(i) {
  const id = i.customId;

  // buy buttons
  if (id.startsWith('buy:vbucks:pack:')) {
    const amount = parseInt(id.split(':').pop(), 10);
    const price = (amount / 1000) * PRICE_PER_1K_VBUCKS;
    return sendPayPalPrompt(i, 'vbucks', amount, price);
  }
  if (id.startsWith('buy:robux:pack:')) {
    const amount = parseInt(id.split(':').pop(), 10);
    const price = (amount / 1000) * PRICE_PER_1K_ROBUX;
    return sendPayPalPrompt(i, 'robux', amount, price);
  }
  if (id === 'buy:vbucks:giftcard') {
    await getUser(i.user.id);
    const { data: order } = await sb.from('orders').insert({
      discord_id: i.user.id, currency: 'vbucks', amount: GIFTCARD_VBUCKS,
      price_gbp: 10, payment_method: 'Roblox £10 Gift Card',
    }).select('*').single();
    await postOrderApproval(order, i.user.tag);
    return ephem(i,
      `🎟️ **Roblox £10 Gift Card → ${GIFTCARD_VBUCKS} V-Bucks**\nDM the gift card code to an admin. Once verified, **${GIFTCARD_VBUCKS}** V-Bucks will be credited to your balance.\nOrder ID: \`${order.id}\``);
  }
  if (id === 'buy:confirm:cancel') {
    return i.update({ content: 'Cancelled.', components: [] });
  }
  if (id.startsWith('buy:confirm:')) {
    // buy:confirm:<currency>:<amount>:<price>
    const [, , currency, amountStr, priceStr] = id.split(':');
    const amount = parseInt(amountStr, 10);
    const price = parseFloat(priceStr);
    await getUser(i.user.id);
    const { data: order } = await sb.from('orders').insert({
      discord_id: i.user.id, currency, amount, price_gbp: price, payment_method: 'PayPal',
    }).select('*').single();
    await postOrderApproval(order, i.user.tag);
    return i.update({
      content: `✅ Order placed. Pay **${fmtGBP(price)}** via PayPal: ${PAYPAL_LINK}\nOnce payment is confirmed by an admin, your balance will be credited.\nOrder ID: \`${order.id}\``,
      components: [],
    });
  }

  // approval buttons
  if (id.startsWith('order:') || id.startsWith('redeem:')) {
    if (!isAdmin(i.member)) return ephem(i, 'Admins only.');
    const [kind, action, recordId] = id.split(':');
    const table = kind === 'order' ? 'orders' : 'redemptions';
    const { data: rec } = await sb.from(table).select('*').eq('id', recordId).single();
    if (!rec) return ephem(i, 'Record not found.');
    if (rec.status !== 'pending') return ephem(i, `Already ${rec.status}.`);

    const status = action === 'approve' ? (kind === 'order' ? 'paid' : 'sent') : 'rejected';

    if (action === 'approve') {
      if (kind === 'order') {
        await adjustBalance(rec.discord_id, rec.currency, rec.amount);
      } else {
        await adjustBalance(rec.discord_id, rec.currency, -rec.amount);
      }
    }

    await sb.from(table).update({
      status, actioned_by: i.user.id, actioned_at: new Date().toISOString(),
    }).eq('id', recordId);

    const oldEmbed = i.message.embeds[0];
    const newEmbed = EmbedBuilder.from(oldEmbed)
      .setColor(action === 'approve' ? 0x2ecc71 : 0xe74c3c)
      .setTitle(`${oldEmbed.title.split(' — ')[0]} — ${status}`)
      .addFields({ name: 'Actioned by', value: `<@${i.user.id}> at <t:${Math.floor(Date.now() / 1000)}:f>` });

    await i.update({ embeds: [newEmbed], components: [] });
    try {
      const user = await client.users.fetch(rec.discord_id);
      await user.send(
        kind === 'order'
          ? `Your order (${rec.amount} ${rec.currency}) was **${status}**.`
          : `Your redemption (${rec.amount} ${rec.currency} → ${rec.username}) was **${status}**.`,
      );
    } catch {}
    return;
  }
}

async function sendPayPalPrompt(i, currency, amount, price) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`buy:confirm:${currency}:${amount}:${price.toFixed(2)}`).setLabel(`Confirm — pay ${fmtGBP(price)} via PayPal`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('buy:confirm:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return i.update({
    content: `**${amount.toLocaleString()} ${currency}** = **${fmtGBP(price)}** via PayPal\nLink: ${PAYPAL_LINK}\nClick confirm once you've paid (admin will verify).`,
    components: [row],
  });
}

async function handleModal(i) {
  if (i.customId === 'modal:redeem:vbucks') {
    const epic = i.fields.getTextInputValue('epic').trim();
    const item = i.fields.getTextInputValue('item').trim();
    const amount = parseInt(i.fields.getTextInputValue('amount').trim(), 10);
    if (!Number.isFinite(amount) || amount <= 0) return ephem(i, 'Amount must be a positive number.');
    const u = await getUser(i.user.id);
    if (amount > u.vbucks_balance) return ephem(i, `You only have ${u.vbucks_balance} V-Bucks.`);
    const { data: r } = await sb.from('redemptions').insert({
      discord_id: i.user.id, currency: 'vbucks', amount, username: epic, item,
    }).select('*').single();
    await postRedemptionApproval(r, i.user.tag);
    return ephem(i, `✅ Redemption submitted: **${amount}** V-Bucks for **${item}** to **${epic}**. Pending admin send.`);
  }
  if (i.customId === 'modal:redeem:robux') {
    const username = i.fields.getTextInputValue('user').trim();
    const amount = parseInt(i.fields.getTextInputValue('amount').trim(), 10);
    if (!Number.isFinite(amount) || amount <= 0) return ephem(i, 'Amount must be a positive number.');
    const u = await getUser(i.user.id);
    if (amount > u.robux_balance) return ephem(i, `You only have ${u.robux_balance} Robux.`);
    const { data: r } = await sb.from('redemptions').insert({
      discord_id: i.user.id, currency: 'robux', amount, username,
    }).select('*').single();
    await postRedemptionApproval(r, i.user.tag);
    return ephem(i, `✅ Redemption submitted: **${amount}** Robux to **${username}**. Pending admin send.`);
  }
}

async function handleSelect() { /* unused */ }

// ---------- boot ----------
(async () => {
  if (!DISCORD_TOKEN) {
    console.warn('[warn] DISCORD_TOKEN not set — bot will not log in. HTTP server still running.');
    return;
  }
  await registerCommands().catch(e => console.error('[discord] register failed', e));
  await client.login(DISCORD_TOKEN);
})();
