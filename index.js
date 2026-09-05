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

// Canalul cu cele 3 butoane
const PONTAJ_CHANNEL_ID = "1545859782391504916";

// Canalul pentru administrare
const ADMIN_CHANNEL_ID = "1545873888494358639";

// Fusul orar folosit pentru programul de pontaj
const TIME_ZONE = "Europe/Bucharest";

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

// =========================
// FUNCȚII UTILE
// =========================

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

// Ora locală din România
function getRomaniaTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(new Date());

    const result = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            result[part.type] = Number(part.value);
        }
    }

    return result;
}

// Verifică dacă în acest moment se poate porni pontajul.
// Program: 10:00 - 02:00
function isPontajOpen() {
    const time = getRomaniaTime();

    const minutes = time.hour * 60 + time.minute;

    // 10:00 = 600
    // 02:00 = 120

    return minutes >= 600 || minutes < 120;
}

// Câte secunde au trecut de la ora 02:00,
// folosind ora României.
function secondsSinceTwoAM() {
    const time = getRomaniaTime();

    const minutesAfterTwo =
        (time.hour * 60 + time.minute) - 120;

    return Math.max(0, minutesAfterTwo * 60 + time.second);
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
        .setName("porniti")
        .setDescription("Vezi cine este momentan în tură"),

    new SlashCommandBuilder()
        .setName("resetpontaj")
        .setDescription("Resetează pontajele pentru noua săptămână")
].map(command => command.toJSON());

// =========================
// ÎNCHIDERE AUTOMATĂ LA 02:00
// =========================

function autoStopShifts() {

    const time = getRomaniaTime();

    // Între 02:00 și 10:00 nu trebuie să existe ture active.
    const minutes = time.hour * 60 + time.minute;

    if (minutes < 120 || minutes >= 600) {
        // Dacă este înainte de 02:00, nu facem nimic.
        if (minutes >= 120 && minutes < 600) {
            // codul este tratat mai jos
        } else if (minutes < 120) {
            return;
        }
    }

    // În intervalul 02:00 - 10:00 închidem toate turele.
    if (minutes >= 120 && minutes < 600) {

        const activeUsers = db
            .prepare(`
                SELECT *
                FROM users
                WHERE clock_in IS NOT NULL
            `)
            .all();

        if (activeUsers.length === 0) return;

        const now = Math.floor(Date.now() / 1000);
        const secondsFromTwo = secondsSinceTwoAM();

        // Momentul exact aproximativ al orei 02:00
        const cutoff = now - secondsFromTwo;

        for (const user of activeUsers) {

            const workedSeconds = Math.max(
                0,
                cutoff - user.clock_in
            );

            const newTotal =
                user.total_seconds + workedSeconds;

            db.prepare(`
                UPDATE users
                SET total_seconds = ?, clock_in = NULL
                WHERE user_id = ?
            `).run(newTotal, user.user_id);

            console.log(
                `Tura utilizatorului ${user.user_id} a fost oprită automat la 02:00.`
            );
        }
    }
}

// Verificăm periodic dacă există ture care trebuie închise.
setInterval(() => {
    try {
        autoStopShifts();
    } catch (error) {
        console.error("Eroare la oprirea automată:", error);
    }
}, 30000);

// =========================
// PANOU PONTAJ
// =========================

async function sendPontajMessage(channel) {

    const embed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle("🏢 LEFORTS — PONTAJ")
        .setDescription(
            "Folosește butoanele de mai jos pentru a-ți înregistra tura.\n\n" +
            "🕐 Program pontaj: **10:00 - 02:00**"
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

    // Căutăm panoul existent ca să nu creăm duplicate.
    const messages = await channel.messages.fetch({
        limit: 50
    });

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

    // Închide eventualele ture rămase active
    // dacă botul a fost oprit în jurul orei 02:00.
    try {
        autoStopShifts();
    } catch (error) {
        console.error(
            "Eroare la verificarea turelor active:",
            error
        );
    }

    // Înregistrează comenzile slash
    try {

        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

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

            console.log(
                `Comenzile au fost înregistrate pe serverul ${guild.name}.`
            );
        }

    } catch (error) {

        console.error(
            "Eroare la înregistrarea comenzilor:",
            error
        );
    }

    // Creează / actualizează panoul
    try {

        const channel =
            await client.channels.fetch(PONTAJ_CHANNEL_ID);

        if (channel) {
            await sendPontajMessage(channel);
        }

    } catch (error) {

        console.error(
            "Nu pot accesa canalul de pontaj:",
            error
        );
    }
});

// =========================
// INTERACȚIUNI
// =========================

client.on(
    Events.InteractionCreate,
    async interaction => {

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

                // Verificăm programul 10:00 - 02:00
                if (!isPontajOpen()) {

                    return interaction.reply({
                        content:
                            "⛔ **Pontajul este închis momentan.**\n\n" +
                            "🕐 Programul de pontaj este **10:00 - 02:00**.",
                        ephemeral: true
                    });
                }

                if (user.clock_in) {

                    return interaction.reply({
                        content:
                            "⚠️ **Ești deja în tură!**",
                        ephemeral: true
                    });
                }

                const now =
                    Math.floor(Date.now() / 1000);

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
                        content:
                            "⚠️ **Nu ai o tură activă.**",
                        ephemeral: true
                    });
                }

                const now =
                    Math.floor(Date.now() / 1000);

                let stopTime = now;

                // Dacă cineva încearcă să oprească după 02:00,
                // limităm tura la ora 02:00.
                if (!isPontajOpen()) {

                    const time = getRomaniaTime();

                    const minutes =
                        time.hour * 60 + time.minute;

                    if (minutes >= 120 && minutes < 600) {

                        stopTime =
                            now - secondsSinceTwoAM();
                    }
                }

                const workedSeconds =
                    Math.max(0, stopTime - user.clock_in);

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

                let total =
                    user.total_seconds;

                let status =
                    "🔴 Nu ești în tură";

                if (user.clock_in) {

                    const now =
                        Math.floor(Date.now() / 1000);

                    let currentTime = now;

                    // Dacă este după 02:00, timpul activ
                    // se calculează doar până la 02:00.
                    if (!isPontajOpen()) {

                        const time =
                            getRomaniaTime();

                        const minutes =
                            time.hour * 60 + time.minute;

                        if (
                            minutes >= 120 &&
                            minutes < 600
                        ) {
                            currentTime =
                                now - secondsSinceTwoAM();
                        }
                    }

                    total += Math.max(
                        0,
                        currentTime - user.clock_in
                    );

                    status =
                        "🟢 Ești în tură";
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

        if (!interaction.isChatInputCommand()) {
            return;
        }

        // Comenzile administrative funcționează
        // doar în canalul de administrare.
        if (interaction.channelId !== ADMIN_CHANNEL_ID) {

            return interaction.reply({
                content:
                    "⛔ Această comandă poate fi folosită doar în canalul de administrare.",
                ephemeral: true
            });
        }

        // Doar administratorii
        if (
            !interaction.memberPermissions.has(
                PermissionFlagsBits.Administrator
            )
        ) {

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

            let text =
                "📊 **PONTAJ ANGAJAȚI**\n\n";

            for (const user of users) {

                let total =
                    user.total_seconds;

                let status =
                    "🔴 Nu este în tură";

                if (user.clock_in) {

                    const now =
                        Math.floor(Date.now() / 1000);

                    let currentTime = now;

                    if (!isPontajOpen()) {

                        const time =
                            getRomaniaTime();

                        const minutes =
                            time.hour * 60 + time.minute;

                        if (
                            minutes >= 120 &&
                            minutes < 600
                        ) {
                            currentTime =
                                now - secondsSinceTwoAM();
                        }
                    }

                    total += Math.max(
                        0,
                        currentTime - user.clock_in
                    );

                    status =
                        "🟢 ÎN TURĂ";
                }

                let member;

                try {

                    member =
                        await interaction.guild.members.fetch(
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

            if (text.length > 1900) {

                text =
                    "📊 **PONTAJ ANGAJAȚI**\n\n" +
                    "Sunt prea mulți angajați pentru un singur mesaj.";
            }

            return interaction.reply({
                content: text,
                ephemeral: false
            });
        }

        // ==================================================
        // /PORNITI
        // ==================================================

        if (interaction.commandName === "porniti") {

            const users = db
                .prepare(`
                    SELECT *
                    FROM users
                    WHERE clock_in IS NOT NULL
                    ORDER BY clock_in ASC
                `)
                .all();

            if (users.length === 0) {

                return interaction.reply({
                    content:
                        "🟢 **ANGAJAȚI ÎN TURĂ**\n\n" +
                        "Nu este nimeni în tură momentan.",
                    ephemeral: false
                });
            }

            let text =
                "🟢 **ANGAJAȚI ÎN TURĂ**\n\n";

            const now =
                Math.floor(Date.now() / 1000);

            for (const user of users) {

                let currentTime = now;

                // Limităm timpul la 02:00
                if (!isPontajOpen()) {

                    const time =
                        getRomaniaTime();

                    const minutes =
                        time.hour * 60 + time.minute;

                    if (
                        minutes >= 120 &&
                        minutes < 600
                    ) {
                        currentTime =
                            now - secondsSinceTwoAM();
                    }
                }

                const activeSeconds =
                    Math.max(
                        0,
                        currentTime - user.clock_in
                    );

                let member;

                try {

                    member =
                        await interaction.guild.members.fetch(
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
                    `⏱️ În tură de **${formatTime(activeSeconds)}**\n\n`;
            }

            text +=
                `👥 **Total în tură: ${users.length}**`;

            return interaction.reply({
                content: text,
                ephemeral: false
            });
        }

        // ==================================================
        // /RESETPONTAJ
        // ==================================================

        if (interaction.commandName === "resetpontaj") {

            const now =
                Math.floor(Date.now() / 1000);

            // Angajații care NU sunt în tură
            // pornesc săptămâna de la 0.
            db.prepare(`
                UPDATE users
                SET total_seconds = 0
                WHERE clock_in IS NULL
            `).run();

            // Angajații care SUNT în tură:
            // timpul vechi se resetează, dar tura continuă.
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
                    "Turele active continuă de la momentul resetării.",
                ephemeral: false
            });
        }
    }
);

// =========================
// LOGIN
// =========================

client.login(TOKEN);
