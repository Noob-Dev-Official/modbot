import Bot from '../bot/Bot.js';
import {
    ApplicationCommandPermissionType,
    ApplicationCommandType,
    PermissionFlagsBits, RESTJSONErrorCodes
} from 'discord.js';
import {AUTOCOMPLETE_OPTIONS_LIMIT} from '../util/apiLimits.js';
import Cache from '../Cache.js';
import {formatTime} from '../util/timeutils.js';

import ArticleCommand from './external/ArticleCommand.js';
import AvatarCommand from './user/AvatarCommand.js';
import ExportCommand from './bot/ExportCommand.js';
import ImportCommand from './bot/ImportCommand.js';
import InfoCommand from './bot/InfoCommand.js';
import UserInfoCommand from './user/UserInfoCommand.js';
import MemberWrapper from '../discord/MemberWrapper.js';
import BanCommand from './user/BanCommand.js';
import UnbanCommand from './user/UnbanCommand.js';
import VideoCommand from './external/VideoCommand.js';
import KickCommand from './user/KickCommand.js';
import MuteCommand from './user/MuteCommand.js';
import UnmuteCommand from './user/UnmuteCommand.js';
import StrikeCommand from './user/StrikeCommand.js';
import PardonCommand from './user/PardonCommand.js';
import ModerationCommand from './moderation/ModerationCommand.js';
import SettingsCommand from './settings/SettingsCommand.js';
import LockCommand from './guild/LockCommand.js';

const cooldowns = new Cache();

export default class CommandManager {
    static #instance;

    /**
     * @type {Command[]}
     */
    #commands = [
        // BOT
        new ExportCommand(),
        new ImportCommand(),
        new InfoCommand(),

        // EXTERNAL
        new ArticleCommand(),
        new VideoCommand(),

        // USER
        new AvatarCommand(),
        new UserInfoCommand(),
        new BanCommand(),
        new UnbanCommand(),
        new KickCommand(),
        new MuteCommand(),
        new UnmuteCommand(),
        new StrikeCommand(),
        new PardonCommand(),

        // MODERATION
        new ModerationCommand(),

        // SETTINGS
        new SettingsCommand(),

        // GUILD
        new LockCommand(),
    ];

    static get instance() {
        return this.#instance ??= new CommandManager();
    }

    /**
     * @return {Command[]}
     */
    getCommands() {
        return this.#commands;
    }

    /**
     * register all slash commands
     * @return {Promise<void>}
     */
    async register() {
        /** @type {import('discord.js').ApplicationCommandDataResolvable[]} */
        const commands = [];
        for (const command of this.getCommands()) {
            commands.push(command.buildSlashCommand());
            if (command.supportsMessageCommands()) {
                commands.push(command.buildMessageCommand());
            }
            if (command.supportsUserCommands()) {
                commands.push(command.buildUserCommand());
            }
        }

        for (const [id, command] of await Bot.instance.client.application.commands.set(commands)) {
            if (command.type === ApplicationCommandType.ChatInput) {
                this.findCommand(command.name).id = id;
            }
        }
    }

    /**
     * find a command with this name
     * @param {string} name
     * @return {Command}
     */
    findCommand(name) {
        return this.getCommands().find(c => c.getName() === name.toLowerCase()) ?? null;
    }

    /**
     * check if this command can be executed in this context
     * @param {?ExecutableCommand} command
     * @param {import('discord.js').Interaction} interaction
     * @return {Promise<boolean>} is command executable
     */
    async checkCommandAvailability(command, interaction) {
        if (!command) {
            return false;
        }

        if (interaction.inGuild()) {
            const missingBotPermissions = interaction.appPermissions.missing(command.getRequiredBotPermissions());
            if (missingBotPermissions.length) {
                await interaction.reply({
                    content: `I'm missing the following permissions to execute this command: ${missingBotPermissions}`,
                    ephemeral:true
                });
                return false;
            }
        } else if (!command.isAvailableInDMs()) {
            return false;
        }

        if (command.getCoolDown()) {
            const key = `${interaction.user.id}:${command.getName()}`;
            const entry = cooldowns.getEntry(key);
            if (entry && !entry.isCacheTimeOver) {
                let remaining = entry.until - Date.now();
                remaining = Math.ceil(remaining / 1000);
                remaining = formatTime(remaining);

                await interaction.reply({
                    ephemeral: true,
                    content: `You can use this command again in ${remaining}`,
                });
                return false;
            }
            cooldowns.set(key, null, command.getCoolDown() * 1000);
        }
        return true;
    }

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     * @return {Promise<void>}
     */
    async execute(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }
        await command.execute(interaction);
    }

    /**
     * @param {import('discord.js').AutocompleteInteraction} interaction
     * @return {Promise<void>}
     */
    async autocomplete(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!command) {
            return;
        }

        const options = await command.complete(interaction);

        await interaction.respond(options.slice(0, AUTOCOMPLETE_OPTIONS_LIMIT));
    }

    /**
     * @param {import('discord.js').UserContextMenuCommandInteraction} interaction
     * @return {Promise<void>}
     */
    async executeUserMenu(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }
        await command.executeUserMenu(interaction);
    }

    /**
     * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
     * @return {Promise<void>}
     */
    async executeMessageMenu(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }
        await command.executeMessageMenu(interaction);
    }

    /**
     * @param {import('discord.js').ButtonInteraction} interaction
     * @return {Promise<void>}
     */
    async executeButton(interaction) {
        if (!interaction.customId) {
            return;
        }

        const command = this.findCommand(interaction.customId.split(':')[0]);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }

        if (!command.isAvailableInDMs() && !await this.checkMemberPermissions(interaction, command)) {
            return;
        }

        await command.executeButton(interaction);
    }

    /**
     * @param {import('discord.js').ModalSubmitInteraction} interaction
     * @return {Promise<void>}
     */
    async executeModal(interaction) {
        const command = this.findCommandByCustomId(interaction.customId);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }

        if (!command.isAvailableInDMs() && !await this.checkMemberPermissions(interaction, command)) {
            return;
        }

        await command.executeModal(interaction);
    }

    /**
     * @param {import('discord.js').SelectMenuInteraction} interaction
     * @return {Promise<void>}
     */
    async executeSelectMenu(interaction) {
        const command = this.findCommandByCustomId(interaction.customId);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }

        if (!command.isAvailableInDMs() && !await this.checkMemberPermissions(interaction, command)) {
            return;
        }

        await command.executeSelectMenu(interaction);
    }

    /**
     * @param {?string} id
     * @return {?Command}
     */
    findCommandByCustomId(id) {
        if (!id) {
            return null;
        }

        return this.findCommand(id.split(':')[0]);
    }

    /**
     * @param {import('discord.js').Interaction} interaction
     * @param {Command} command
     * @return {Promise<boolean>}
     */
    async checkMemberPermissions(interaction, command) {
        const permission = await this.hasPermission(interaction, command);
        if (!permission) {
            await interaction.reply({content: 'You\'re not allowed to execute this command!', ephemeral: true});
        }
        return permission;
    }

    /**
     * @param {import('discord.js').Interaction} interaction
     * @param {Command} command
     * @return {Promise<boolean>}
     */
    async hasPermission(interaction, command) {
        const member = await (new MemberWrapper(interaction.user, interaction.guild)).fetchMember();

        if (!interaction.memberPermissions.has(PermissionFlagsBits.UseApplicationCommands)) {
            return false;
        }

        let overrides = null;
        try {
            overrides = await interaction.guild.commands.permissions.fetch({command: command.id});
        }
        catch (e) {
            if (e.code !== RESTJSONErrorCodes.UnknownApplicationCommandPermissions) {
                throw e;
            }
        }

        if (interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return true;
        }

        if (!overrides) {
            switch (command.getDefaultMemberPermissions()) {
                case null:
                    return true;
                case 0:
                    return false;
                default:
                    return interaction.memberPermissions.has(command.getDefaultMemberPermissions());
            }
        }

        const everyoneRoleId = interaction.guild.roles.everyone.id;
        const everyoneOverride = overrides.find(override => override.type === ApplicationCommandPermissionType.Role
            && override.id === everyoneRoleId);
        let permission = false;
        if (everyoneOverride.permission) {
            switch (command.getDefaultMemberPermissions()) {
                case null:
                    permission = true;
                    break;
                case 0:
                    permission = false;
                    break;
                default:
                    permission = interaction.memberPermissions.has(command.getDefaultMemberPermissions());
            }
        }

        const roleOverrides = overrides.filter(override => override.type === ApplicationCommandPermissionType.Role
            && override.id !== everyoneRoleId && member.roles.resolve(override.id));
        if (roleOverrides.some(override => override.permission === false)) {
            permission = false;
        }
        if (roleOverrides.some(override => override.permission === true)) {
            permission = true;
        }

        const memberOverride = overrides.find(override => override.type === ApplicationCommandPermissionType.User
            && override.id === interaction.user.id);
        if (memberOverride) {
            permission = memberOverride.permission;
        }
        return permission;
    }
}