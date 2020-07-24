const util = require('../lib/util.js');

exports.command = async (message, args, database, bot) => {
  if(!message.member.hasPermission('BAN_MEMBERS')) {
    message.react('🛑');
    return;
  }

  let userId = util.userMentionToId(args.shift());
  let user = await bot.users.fetch(userId);

  if (!user) {
    message.react('🛑');
    message.channel.send("User not found!");
    return;
  }

  if(!await database.query("SELECT action FROM moderations WHERE guildid = ? AND userid = ? AND action = 'mute'", [message.guild.id, userId])) {
    message.react('🛑');
    message.channel.send("User isn't muted here!");
    return;
  }

  let reason = (args.join(' ') || 'No reason provided.');
  let now = Math.floor(Date.now()/1000);

  if (message.guild.members.resolve(userId)) {
    message.guild.members.resolve(userId).roles.remove([await util.mutedRole(message.guild.id)], "Temporary mute completed!");
  }

  database.query("UPDATE moderations SET tocheck = 0 WHERE action = 'mute' AND userid = ? AND guildid = ?",[userId,message.guild.id]);
  database.query("INSERT INTO moderations (guildid, userid, action, lastChanged, reason, moderator) VALUES (?,?,'unmute',?,?,?)",[message.guild.id, userId, now, reason, message.author.id]);

  util.log(message, `${message.author.username} unmuted \`${user.username}#${user.discriminator}\`: ${reason}`);
  message.channel.send(`Unmuted \`${user.username}#${user.discriminator}\`: ${reason}`);

}

exports.names = ['unmute'];
