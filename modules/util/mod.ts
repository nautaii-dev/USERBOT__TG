import { toFileUrl } from "std/path/mod.ts";
import { Api, VERSION as telegramVersion } from "$grm";
import { bigInt } from "$grm-deps";
import {
  bold,
  CommandHandler,
  fmt,
  longText,
  Module,
  type Stringable,
  updateMessage,
  version,
} from "$xor";
import { whois } from "./helpers.ts";

const LOAD_TIME = Date.now();

const EVAL_HEADER =
  `import { Api, type NewMessageEvent, type TelegramClient } from "$grm";
import { Methods } from "$xor";

interface EvalParams {
  client: TelegramClient;
  event: NewMessageEvent;
}

export async function eval_({ client, event }: EvalParams): Promise<any> {
  const c = client;
  const e = event;
  const message = event.message;
  const m = message;
  const methods = new Methods(client);
  const reply = await message.getReplyMessage();
  const r = reply;
`;

const EVAL_FOOTER = "}\n";

const util: Module = {
  name: "util",
  handlers: [
    new CommandHandler("ping", async ({ client, event }) => {
      const before = Date.now();
      await client.invoke(new Api.Ping({ pingId: bigInt(0) }));
      const diff = Date.now() - before;
      await updateMessage(event, `${diff}ms`);
    }),
    new CommandHandler(
      "shell",
      async ({ event, args, input }) => {
        if (args.length < 1) {
          return;
        }
        args = args.slice(1);
        let { text } = event.message;
        text = text.slice(text.split(/\s/)[0].length);
        const cmd = text.trim().split(/\s/);
        const proc = Deno.run({
          cmd,
          stdout: "piped",
          stderr: "piped",
          stdin: input.length == 0 ? undefined : "piped",
        });
        text = `[${proc.pid}]${text}`;
        await event.message.edit({ text });
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        if (input.length != 0) {
          proc.stdin?.write(encoder.encode(input));
          proc.stdin?.close();
        }
        const stdout = decoder.decode(await proc.output());
        const stderr = decoder.decode(await proc.stderrOutput());
        if (stdout.length > 0) {
          await event.message.reply(
            longText(stdout, "stdout.txt"),
          );
        }
        if (stderr.length > 0) {
          await event.message.reply(
            longText(stderr, "stderr.txt"),
          );
        }
        const { code } = await proc.status();
        text += "\n" + `Exited with code ${code}.`;
        await event.message.edit({ text });
      },
      {
        aliases: ["sh", "cmd", "exec"],
      },
    ),
    new CommandHandler("uptime", async ({ event }) => {
      let seconds = Math.floor(
        (Date.now() - LOAD_TIME) / 1000,
      );
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds - hours * 3600) / 60);
      seconds = seconds - hours * 3600 - minutes * 60;
      // TODO: use deno std for the time format?
      await updateMessage(
        event,
        (hours > 0 ? `${hours > 9 ? hours : "0" + hours}:` : "") +
          `${minutes > 9 ? minutes : "0" + minutes}:` +
          `${seconds > 9 ? seconds : "0" + seconds}`,
      );
    }),
    new CommandHandler(
      "version",
      async ({ event }) => {
        await updateMessage(
          event,
          `Grm ${telegramVersion}
Xor ${version}

Deno ${Deno.version.deno}
TypeScript ${Deno.version.typescript}
V8 ${Deno.version.v8}`,
        );
      },
      { aliases: ["v"] },
    ),
    new CommandHandler("whois", async ({ client, event, args }) => {
      const info = new Array<Stringable>();
      if (args[0] !== undefined && args[0].length != 0) {
        const entity = await client.getEntity(args[0]);
        info.push((await whois(entity, client)).trim() + "\n\n");
      }
      const chat = await event.message.getChat();
      if (chat) {
        info.push(fmt`${bold("Here")}\n`);
        info.push((await whois(chat, client)).trim() + "\n\n");
      }
      const reply = await event.message.getReplyMessage();
      if (reply) {
        const sender = await reply.getSender();
        if (sender) {
          info.push(fmt`${bold("Reply")}\n`);
          info.push((await whois(sender, client)).trim() + "\n\n");
        }
        if (reply.forward) {
          const sender = await reply.forward.getSender();
          if (sender) {
            info.push(fmt`${bold("Forwarder")}\n`);
            info.push((await whois(sender, client)).trim() + "\n\n");
          }
        }
      }
      if (info.length == 0) {
        return;
      }
      await updateMessage(event, fmt(["\n", ...info.map(() => "")], ...info));
    }),
    new CommandHandler("eval", async ({ client, event, input }) => {
      const path = await Deno.makeTempFile({ suffix: ".ts" });
      await Deno.writeTextFile(path, `${EVAL_HEADER}${input}${EVAL_FOOTER}`);
      const { eval_ } = await import(toFileUrl(path).href);
      await Deno.remove(path);
      let result = JSON.stringify(
        await eval_({ client, event }),
        null,
        4,
      );
      if (!result) {
        await event.message.reply({
          message: "No output.",
        });
        return;
      }
      if (result.startsWith('"')) {
        result = result.replace(/"/g, "");
      }
      await event.message.reply(
        longText(result, "result.txt"),
      );
    }, { allowEdit: true }),
  ],
  help: fmt`${bold("Introduction")}

The util module includes some useful commands to interact with the system and get basic information of the surrounding.

${bold("Commands")}

- ping

Tells how much a ping of Telegram servers takes.

- shell, sh, cmd, exec

Runs a shell command and sends its output. Any input will be passed to the stdin of the process.

- uptime

Displays the uptime of the bot in (hh:)mm:ss format.

- version, v

Displays the versions of Xor and other software.

- whois

Fetches and displays basic information about the current chat, the provided identifier as the first argument and/or the replied message. The provided identifier can be a username, a phone number, a user/chat ID or a chat invite ID.

- eval

Runs and sends the output of JavaScript code. As of now, it passes the client as \`client | c\`, the \`NewMessageEvent\` as \`event | e\`, the message as \`message | m\`, the replied message as \`reply | r\`, xorgram-methods instance as \`methods\` and the API namespace as \`Api\`.`,
};

export default util;
