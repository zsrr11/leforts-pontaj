const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Events,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

const Database = require("better-sqlite3");

// =========================
// CONFIGURARE
// =========================

const TOKEN = process.env.DISCORD_TOKEN;

// Canalul unde sunt cele 3 butoane
const PONTAJ_CHANNEL_ID = "1545859782391504916";

// Canalul unde administratorii văd pontajele
const ADMIN_CHANNEL_ID = "1545873888494358639";

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

// =========================
// COMENZI SLASH
// =========================

const commands = [
    new SlashCommandBuilder()
        .setName("pontaje")
        .setDescription("Vezi pontajele tuturor angajaților"),

    new SlashCommandBuilder()
        .setName("resetpontaj")
        .setDescription("Resetează pontajele pentru noua săptămână")
].map(command => command.toJSON());

// =========================
// PANOU PONTAJ
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

    // Caută un panou existent pentru a evita duplicatele
    const messages = await channel.messages.fetch({ limit: 50 });

    const existingMessage = messages.find(message =>
        message.author.id === client.user.id &&
        message.embeds.length > 0 &&
        message.embeds[0].title === "🏢 LEFORTS — PONTAJ"
    );

    if (existingMessage) {
        await existingMessage.edit({
            embeds: [embed],
            components: [row]
        });

        console.log("Panoul existent a fost actualizat.");
        return;
    }

    await channel.send({
        embeds: [embed],
        components: [row]
    });

    console.log("Panoul de pontaj a fost creat.");
}

// =========================
// BOT ONLINE
// =========================

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

    // Înregistrează comenzile slash pe serverele unde se află botul
    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        for (const guild of client.guilds.cache.values()) {

            await rest.put(
                Routes.applicationGuildCommands(
                    client.user.id,
                    guild.id
                ),
                {
                    body: commands
                }
            );

            console.log(`Comenzile au fost înregistrate pe serverul ${guild.name}.`);
        }
    } catch (error) {
        console.error("Eroare la înregistrarea comenzilor:", error);
    }

    // Creează / actualizează panoul
    try {
        const channel = await client.channels.fetch(PONTAJ_CHANNEL_ID);

        if (channel) {
            await sendPontajMessage(channel);
        }
    } catch (error) {
        console.error("Nu pot accesa canalul de pontaj:", error);
    }
});

// =========================
// INTERACȚIUNI
// =========================

client.on(Events.InteractionCreate, async interaction => {

    // ==================================================
    // BUTOANE
    // ==================================================

    if (interaction.isButton()) {

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
                content:
                    "🟢 **Tura a început!**\n" +
                    "Pontajul tău a fost pornit.",
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

            const newTotal =
                user.total_seconds + workedSeconds;

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

        return;
    }

    // ==================================================
    // COMENZI SLASH
    // ==================================================

    if (!interaction.isChatInputCommand()) return;

    // Comenzile sunt permise doar în canalul de admin
    if (interaction.channelId !== ADMIN_CHANNEL_ID) {

        return interaction.reply({
            content:
                "⛔ Această comandă poate fi folosită doar în canalul de administrare.",
            ephemeral: true
        });
    }

    // Doar administratori
    if (!interaction.memberPermissions.has(
        PermissionFlagsBits.Administrator
    )) {

        return interaction.reply({
            content:
                "⛔ Nu ai permisiunea de a folosi această comandă.",
            ephemeral: true
        });
    }

    // ==================================================
    // /PONTAJE
    // ==================================================

    if (interaction.commandName === "pontaje") {

        const users = db
            .prepare(`
                SELECT *
                FROM users
                ORDER BY total_seconds DESC
            `)
            .all();

        if (users.length === 0) {

            return interaction.reply({
                content:
                    "📊 **PONTAJ ANGAJAȚI**\n\n" +
                    "Nu există încă pontaje înregistrate.",
                ephemeral: false
            });
        }

        let text = "📊 **PONTAJ ANGAJAȚI**\n\n";

        for (const user of users) {

            let total = user.total_seconds;
            let status = "🔴 Nu este în tură";

            if (user.clock_in) {

                const now = Math.floor(Date.now() / 1000);

                total += now - user.clock_in;

                status = "🟢 ÎN TURĂ";
            }

            let member;

            try {
                member = await interaction.guild.members.fetch(
                    user.user_id
                );
            } catch {
                member = null;
            }

            const name = member
                ? member.displayName
                : `ID: ${user.user_id}`;

            text +=
                `👤 **${name}**\n` +
                `⏱️ ${formatTime(total)}\n` +
                `${status}\n\n`;
        }

        // Discord are limită de caractere pe mesaj.
        if (text.length > 1900) {

            text =
                "📊 **PONTAJ ANGAJAȚI**\n\n" +
                "Sunt prea mulți angajați pentru un singur mesaj. " +
                "Vom îmbunătăți lista cu paginare ulterior.";
        }

        return interaction.reply({
            content: text,
            ephemeral: false
        });
    }

    // ==================================================
    // /RESETPONTAJ
    // ==================================================

    if (interaction.commandName === "resetpontaj") {

        const now = Math.floor(Date.now() / 1000);

        // Pentru cei care NU sunt în tură:
        // resetăm complet timpul.
        db.prepare(`
            UPDATE users
            SET total_seconds = 0
            WHERE clock_in IS NULL
        `).run();

        // Pentru cei care SUNT în tură:
        // resetăm timpul și pornim o nouă perioadă
        // exact din momentul resetării.
        db.prepare(`
            UPDATE users
            SET total_seconds = 0,
                clock_in = ?
            WHERE clock_in IS NOT NULL
        `).run(now);

        return interaction.reply({
            content:
                "🔄 **Pontajele au fost resetate!**\n\n" +
                "Săptămâna nouă a început.\n" +
                "Angajații care erau în tură au rămas în tură, " +
                "iar timpul lor se calculează de la momentul resetării.",
            ephemeral: false
        });
    }
});

// =========================
// LOGIN
// =========================

client.login(TOKEN);
