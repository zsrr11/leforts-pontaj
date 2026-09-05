const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Events
} = require("discord.js");

const Database = require("better-sqlite3");

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("Lipsește DISCORD_TOKEN!");
    process.exit(1);
}

// =========================
// BAZA DE DATE
// =========================

const db = new Database("pontaj.db");

db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        total_seconds INTEGER DEFAULT 0,
        clock_in INTEGER DEFAULT NULL
    )
`).run();

function getUser(userId) {
    let user = db
        .prepare("SELECT * FROM users WHERE user_id = ?")
        .get(userId);

    if (!user) {
        db.prepare(`
            INSERT INTO users (user_id, total_seconds, clock_in)
            VALUES (?, 0, NULL)
        `).run(userId);

        user = db
            .prepare("SELECT * FROM users WHERE user_id = ?")
            .get(userId);
    }

    return user;
}

function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return `${hours}h ${minutes}m`;
}

// =========================
// CLIENT DISCORD
// =========================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});
client.once(Events.ClientReady, async () => {
    console.log(`LeForts este online ca ${client.user.tag}`);

    client.user.setPresence({
        activities: [
            {
                name: "Pontaj FiveM"
            }
        ],
        status: "online"
    });

    const channel = await client.channels.fetch("1545859782391504916");

    if (channel) {
        await sendPontajMessage(channel);
        console.log("Panoul de pontaj a fost trimis.");
    }
});

client.once(Events.ClientReady, async () => {
    console.log(`LeForts este online ca ${client.user.tag}`);

    // Setează statusul botului
    client.user.setPresence({
        activities: [
            {
                name: "Pontaj FiveM"
            }
        ],
        status: "online"
    });
});

// =========================
// MESAJUL DE PONTAJ
// =========================

async function sendPontajMessage(channel) {

    const embed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle("🏢 LEFORTS — PONTAJ")
        .setDescription(
            "Folosește butoanele de mai jos pentru a-ți înregistra tura."
        );

    const row = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
            .setCustomId("pontaj_start")
            .setLabel("PORNEȘTE")
            .setEmoji("🟢")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("pontaj_stop")
            .setLabel("OPREȘTE")
            .setEmoji("🔴")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("pontaj_time")
            .setLabel("TIMPUL MEU")
            .setEmoji("⏱️")
            .setStyle(ButtonStyle.Primary)
    );

    await channel.send({
        embeds: [embed],
        components: [row]
    });
}

// =========================
// BUTOANE
// =========================

client.on(Events.InteractionCreate, async interaction => {

    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    const user = getUser(userId);

    // -------------------------
    // PORNEȘTE
    // -------------------------

    if (interaction.customId === "pontaj_start") {

        if (user.clock_in) {
            return interaction.reply({
                content: "⚠️ Ești deja în tură!",
                ephemeral: true
            });
        }

        const now = Math.floor(Date.now() / 1000);

        db.prepare(`
            UPDATE users
            SET clock_in = ?
            WHERE user_id = ?
        `).run(now, userId);

        return interaction.reply({
            content: "🟢 **Tura a început!**\nPontajul tău a fost pornit.",
            ephemeral: true
        });
    }

    // -------------------------
    // OPREȘTE
    // -------------------------

    if (interaction.customId === "pontaj_stop") {

        if (!user.clock_in) {
            return interaction.reply({
                content: "⚠️ Nu ai o tură activă.",
                ephemeral: true
            });
        }

        const now = Math.floor(Date.now() / 1000);
        const workedSeconds = now - user.clock_in;

        const newTotal = user.total_seconds + workedSeconds;

        db.prepare(`
            UPDATE users
            SET total_seconds = ?, clock_in = NULL
            WHERE user_id = ?
        `).run(newTotal, userId);

        return interaction.reply({
            content:
                `🔴 **Tura a fost oprită!**\n\n` +
                `⏱️ Durata turei: **${formatTime(workedSeconds)}**\n` +
                `📊 Timp înregistrat: **${formatTime(newTotal)}**`,
            ephemeral: true
        });
    }

    // -------------------------
    // TIMPUL MEU
    // -------------------------

    if (interaction.customId === "pontaj_time") {

        let total = user.total_seconds;
        let status = "🔴 Nu ești în tură";

        if (user.clock_in) {
            const now = Math.floor(Date.now() / 1000);
            total += now - user.clock_in;
            status = "🟢 Ești în tură";
        }

        return interaction.reply({
            content:
                `⏱️ **TIMPUL MEU**\n\n` +
                `Timp înregistrat: **${formatTime(total)}**\n\n` +
                `Status: ${status}`,
            ephemeral: true
        });
    }
});

// =========================
// LOGIN
// =========================

client.login(TOKEN);
