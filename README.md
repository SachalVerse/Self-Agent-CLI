# SelfAgent

```text
  ___ ___ _    ___   _   ___ ___ _  _ _____ 
 / __| __| |  | __| /_\ / __| __| \| |_   _|
 \__ \ _|| |__| _| / _ \ (_ | _|| .` | | |
 |___/___|____|_| /_/ \_\___|___|_|\_| |_|
```

<div align="center">

### **The Autonomous AI Agent & Secure WhatsApp Gateway Engine**

*Install once, start the server, and command your AI assistant from either your CLI console or directly from WhatsApp.*

[![npm version](https://img.shields.io/npm/v/selfagent0.svg?color=gold&style=flat-square)](https://www.npmjs.com/package/selfagent0)
![node engine](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)
![downloads](https://img.shields.io/badge/downloads-100%2B-purple?style=flat-square)

---

</div>

## 📖 Overview

**SelfAgent** is a powerful cross-platform CLI console and WhatsApp Gateway wrapper built for developers who want an autonomous, secure, and smart AI assistant on their machine.

Unlike messy CLI applications that store keys in plaintext `.env` files or litter your active directory with logs, SelfAgent is built to **production-grade enterprise standards**:
* **Secure Keychain Encrypted Secrets:** Encrypts and saves your credentials (Groq, NVIDIA, GitHub, phone numbers) directly inside the OS secret store (Windows DPAPI, macOS Keychain, Linux libsecret).
* **Zero Active-Directory Clutter:** All runtime configurations, authentication states, database store files, and logs are housed isolated in the user's home directory (`~/.selfagent/`).
* **Non-Corrupting CLI Console:** Features a custom CLI REPL stdout interceptor that dynamically detects active typing lines and redrafts the prompt when background events log to the screen.

---

## 🔐 Hardware & OS Security Backends

SelfAgent secures your private tokens using the native operating system cryptography keyrings:

| OS | Native Keychain Store | Fallback Mechanism |
| :--- | :--- | :--- |
| **Windows** | **DPAPI (Data Protection API)** via encrypted host calls | AES-256-GCM local key store |
| **macOS** | **Keychain Services** via native security wrappers | AES-256-GCM local key store |
| **Linux** | **libsecret / secret-tool** package | Secure AES-256-GCM local key store |

---

## 🌟 Key Features

* 🤖 **Groq Llama 3.3 Engine:** Superfast chat replies from Groq's high-performance API (with NVIDIA API fallback capabilities).
* 📱 **WhatsApp Gateway:** Built on a fast WhatsApp socket connection. Scan a single terminal QR code once, and you are paired. 
* 🎙️ **Voice Messages Processing:** Transcribes received voice notes on WhatsApp (Whisper) and replies with a synthesised voice file (Text-to-Speech).
* ⏰ **Flexible Task Reminders:** Advanced parser schedules natural-language alerts (e.g. `remind me in 30 seconds`, `tomorrow at 4 PM`, or `at 18:30`). Auto-delivers alert notifications directly to your WhatsApp when due.
* 🛡️ **Silenced Internal Dumps:** Cleaned stdout captures that automatically suppress noisy console output dumps like cryptographic sessions (`Closing session`).

---

## 🚀 Quick Start Guide

### 1. Global Installation (All OS)
Install the package globally using npm (requires **Node.js ≥ 20**):
```bash
npm install -g selfagent0
```

### 2. First-Time Secure Configuration
Execute the setup wizard to securely enter your keys. You will see characters in plain text so you can confirm pasted keys:
```bash
selfagent setup
```
*Alternatively, run a non-interactive setup:*
```bash
selfagent setup --GROQ_API_KEY=gsk_xxx --GITHUB_TOKEN=ghp_xxx
```

### 3. Launch the Server
```bash
selfagent
```
*On launch, you'll be greeted with a QR code in the terminal. Scan it with **WhatsApp (Settings → Linked Devices)** to pair.*

---

## 📦 Publishing to npm

If you want to publish your own fork or custom build of SelfAgent:

1. **Choose a Unique Name:** Open your [package.json](file:///c:/Users/Maher%20Sachal/Desktop/selfagent/package.json) and set the `"name"` field to a unique package name (e.g., `"selfagent-custom"`).
2. **Authenticate with npm:** Run `npm login` to sign in.
3. **Bypass 2FA via Classic Automation Token:**
   - Go to your npm account profile $\rightarrow$ **Access Tokens** $\rightarrow$ **Generate New Token** $\rightarrow$ **Classic Token**.
   - Select **Automation** as the token type (this bypasses 2FA verification prompts during CLI publications).
   - Copy the generated token and link it to your local environment:
     ```bash
     npm config set //registry.npmjs.org/:_authToken "npm_your_automation_token"
     ```
4. **Publish to Registry:**
   ```bash
   npm publish --access public
   ```

---

## 💻 CLI REPL Commands

Once the agent console is active (`selfagent >`), you can manage your system or query the AI:

```text
selfagent > /help          → Show the CLI command reference shortcuts
selfagent > connect        → Display the pairing QR code
selfagent > status         → Fetch system health, RAM usage, and uptime
selfagent > resources      → Manually query developer APIs, credits & free tools
selfagent > reset          → Clear all memories, unlink WhatsApp, and purge local keys
selfagent > feed 15        → Set discovery broadcasts to WhatsApp every 15 minutes
selfagent > exit           → Gracefully stop the terminal console and gateway
```
*Or simply type any question:*
```text
selfagent > tell me which whatsapp number is connected
⚡ SelfAgent
You are currently connected on WhatsApp phone number: 923440442160
```

---

## ⏰ Flexible Reminder Examples

Schedule task alerts naturally through the CLI or WhatsApp chat:

* **Relative times:** `remind me to check API keys in 45 seconds`
* **Relative days:** `remind me tomorrow at 9:00 AM to read logs`
* **Absolute daily times:** `remind me to write code at 18:30` (automatically rolls over to tomorrow if the time has already passed today).

---

## ⚙️ Configuration & Paths

All runtime state files are stored in the user's home folder:
* **JSON Config:** `~/.selfagent/config/user_config.json`
* **Saved Reminders Database:** `~/.selfagent/config/reminders.json`
* **WhatsApp Session Database:** `~/.selfagent/auth/baileys/`
* **Winston log streams:** `~/.selfagent/logs/combined.log`

---

## 🛡️ Uninstallation
Remove the package and wipe all local keys/configurations cleanly:
```bash
npm uninstall -g selfagent0
rm -rf ~/.selfagent
```

---

## 📄 License

Distributed under the **MIT License**. Created with ❤️ by [SachalSumra](https://github.com/SachalSumra) and the SelfAgent contributors.
