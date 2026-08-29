#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import process from "node:process";
import QRCode from "qrcode";

const DEFAULT_PORT = 8081;

function printHelp() {
  console.log(`生成 Expo Go 局域网访问二维码

用法：
  npm run qr:expo
  npm run qr:expo -- --host 192.168.1.14 --port 8081
  npm run qr:expo -- --url exp://192.168.1.14:8081

参数：
  --host <host>       覆盖自动检测到的电脑局域网 IP
  --port <port>       Metro 端口，默认 8081
  --url <exp-url>     直接指定完整 exp:// 或 exps:// 地址
  --output <path>     PNG 输出路径，默认 .expo/expo-go-qr.png
  --no-png            只在终端显示二维码，不写 PNG
  --quiet             不在终端绘制二维码，适合自动校验
  --help              显示帮助`);
}

function parseArguments(argv) {
  const options = {
    host: "",
    port: DEFAULT_PORT,
    url: "",
    output: path.resolve(".expo/expo-go-qr.png"),
    writePng: true,
    quiet: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }
    if (argument === "--no-png") {
      options.writePng = false;
      continue;
    }
    if (argument === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (["--host", "--port", "--url", "--output"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} 缺少参数值`);
      }
      index += 1;
      if (argument === "--host") options.host = value;
      if (argument === "--port") options.port = Number(value);
      if (argument === "--url") options.url = value;
      if (argument === "--output") options.output = path.resolve(value);
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`无效端口：${options.port}`);
  }
  return options;
}

function isUsableIpv4(address) {
  return address
    && address !== "0.0.0.0"
    && !address.startsWith("127.")
    && !address.startsWith("169.254.");
}

function detectLanHost() {
  const configured = process.env.EXPO_QR_HOST || process.env.EXPO_PACKAGER_HOSTNAME;
  if (configured) return configured.trim();

  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || !isUsableIpv4(address.address)) continue;
      const priority = name === "en0" ? 0 : name === "en1" ? 1 : /^en\d+$/.test(name) ? 2 : 3;
      candidates.push({ name, address: address.address, priority });
    }
  }
  candidates.sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  return candidates[0]?.address ?? "";
}

function expoUrl(options) {
  if (options.url) {
    let parsed;
    try {
      parsed = new URL(options.url);
    } catch {
      throw new Error(`无效 Expo 地址：${options.url}`);
    }
    if (parsed.protocol !== "exp:" && parsed.protocol !== "exps:") {
      throw new Error("--url 必须使用 exp:// 或 exps:// 协议");
    }
    return parsed.toString();
  }

  const host = options.host || detectLanHost();
  if (!host) {
    throw new Error("未检测到局域网 IPv4 地址，请使用 --host 手动指定电脑 IP");
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(host) || /[/?#]/.test(host)) {
    throw new Error(`--host 只能填写主机名或 IP，不能填写完整 URL：${host}`);
  }
  return `exp://${host}:${options.port}`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const url = expoUrl(options);

  console.log(`Expo Go 地址：${url}`);
  console.log("请确保手机与电脑在同一局域网，并先启动 4000 端口的 API 服务。");

  if (!options.quiet) {
    const terminalQr = await QRCode.toString(url, {
      type: "terminal",
      small: true,
      margin: 1,
      errorCorrectionLevel: "M",
    });
    console.log(terminalQr);
  }

  if (options.writePng) {
    await mkdir(path.dirname(options.output), { recursive: true });
    await QRCode.toFile(options.output, url, {
      width: 640,
      margin: 3,
      errorCorrectionLevel: "M",
    });
    console.log(`二维码图片：${options.output}`);
  }
}

main().catch((error) => {
  console.error(`生成 Expo 二维码失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
