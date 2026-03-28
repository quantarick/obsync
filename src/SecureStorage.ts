// ============================================================
// Obsync — Secure Storage
// ============================================================
// Stores secrets (like GitHub tokens) in the OS keychain directly:
//   - macOS: Keychain Access (via `security` CLI)
//   - Windows: Windows Credential Manager (via PowerShell)
//   - Linux: libsecret (via `secret-tool` CLI)
//
// Why: data.json lives in .obsidian/plugins/obsync/ which can be
// overwritten by git sync operations. The OS keychain is completely
// separate from the vault and visible in system credential managers.
// ============================================================

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class SecureStorage {
	private readonly serviceName: string;

	constructor(pluginId: string) {
		this.serviceName = `obsidian-${pluginId}`;
	}

	/**
	 * Save a secret to the OS keychain.
	 * Creates a visible entry in Keychain Access (macOS) or Credential Manager (Windows).
	 */
	async saveSecret(key: string, value: string): Promise<void> {
		if (!value) {
			await this.deleteSecret(key);
			return;
		}

		const platform = process.platform;
		try {
			if (platform === "darwin") {
				await this.macOSSave(key, value);
			} else if (platform === "win32") {
				await this.windowsSave(key, value);
			} else {
				await this.linuxSave(key, value);
			}
			console.log(`Obsync: Secret "${key}" saved to OS keychain`);
		} catch (err) {
			console.error(`Obsync: Failed to save secret "${key}" to keychain`, err);
			throw err;
		}
	}

	/**
	 * Load a secret from the OS keychain.
	 */
	async loadSecret(key: string): Promise<string | null> {
		const platform = process.platform;
		try {
			if (platform === "darwin") {
				return await this.macOSLoad(key);
			} else if (platform === "win32") {
				return await this.windowsLoad(key);
			} else {
				return await this.linuxLoad(key);
			}
		} catch {
			return null;
		}
	}

	/**
	 * Delete a secret from the OS keychain.
	 */
	async deleteSecret(key: string): Promise<void> {
		const platform = process.platform;
		try {
			if (platform === "darwin") {
				await this.macOSDelete(key);
			} else if (platform === "win32") {
				await this.windowsDelete(key);
			} else {
				await this.linuxDelete(key);
			}
		} catch {
			// Ignore — entry may not exist
		}
	}

	/**
	 * Check if keychain storage is available on this platform.
	 */
	static isAvailable(): boolean {
		return ["darwin", "win32", "linux"].includes(process.platform);
	}

	// -------------------------------------------------------
	// macOS — Keychain Access via `security` CLI
	// -------------------------------------------------------
	// Creates entries visible in: Keychain Access → login → Passwords
	// Service: "obsidian-obsync", Account: key name

	private async macOSSave(key: string, value: string): Promise<void> {
		// Delete first — `security add-generic-password` fails if entry exists
		// unless we use -U (update), but -U can have issues with some keychain configs
		await this.macOSDelete(key).catch(() => {});

		await execFileAsync("security", [
			"add-generic-password",
			"-a", key,
			"-s", this.serviceName,
			"-w", value,
		], { timeout: 10000 });
	}

	private async macOSLoad(key: string): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync("security", [
				"find-generic-password",
				"-a", key,
				"-s", this.serviceName,
				"-w",  // Output only the password value
			], { timeout: 10000 });
			return stdout.trimEnd();
		} catch {
			return null;
		}
	}

	private async macOSDelete(key: string): Promise<void> {
		await execFileAsync("security", [
			"delete-generic-password",
			"-a", key,
			"-s", this.serviceName,
		], { timeout: 10000 });
	}

	// -------------------------------------------------------
	// Windows — Credential Manager via PowerShell
	// -------------------------------------------------------

	private async windowsSave(key: string, value: string): Promise<void> {
		const target = `${this.serviceName}/${key}`;
		// Use cmdkey to store credentials in Windows Credential Manager
		await execFileAsync("cmdkey", [
			`/generic:${target}`,
			`/user:${key}`,
			`/pass:${value}`,
		], { timeout: 10000 });
	}

	private async windowsLoad(key: string): Promise<string | null> {
		const target = `${this.serviceName}/${key}`;
		try {
			// PowerShell is needed to read credential passwords on Windows
			const script = `
				$cred = Get-StoredCredential -Target '${target}' -ErrorAction SilentlyContinue
				if ($cred) { $cred.GetNetworkCredential().Password } else { '' }
			`;
			const { stdout } = await execFileAsync("powershell", [
				"-NoProfile", "-Command", script,
			], { timeout: 10000 });
			const result = stdout.trim();
			return result || null;
		} catch {
			return null;
		}
	}

	private async windowsDelete(key: string): Promise<void> {
		const target = `${this.serviceName}/${key}`;
		await execFileAsync("cmdkey", [
			`/delete:${target}`,
		], { timeout: 10000 });
	}

	// -------------------------------------------------------
	// Linux — libsecret via `secret-tool` CLI
	// -------------------------------------------------------

	private async linuxSave(key: string, value: string): Promise<void> {
		const child = require("child_process").execFile(
			"secret-tool",
			["store", "--label", `${this.serviceName} ${key}`, "service", this.serviceName, "account", key],
			{ timeout: 10000 },
		);
		// secret-tool reads the secret from stdin
		child.stdin.write(value);
		child.stdin.end();
		await new Promise<void>((resolve, reject) => {
			child.on("close", (code: number) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
			child.on("error", reject);
		});
	}

	private async linuxLoad(key: string): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync("secret-tool", [
				"lookup", "service", this.serviceName, "account", key,
			], { timeout: 10000 });
			return stdout || null;
		} catch {
			return null;
		}
	}

	private async linuxDelete(key: string): Promise<void> {
		await execFileAsync("secret-tool", [
			"clear", "service", this.serviceName, "account", key,
		], { timeout: 10000 });
	}
}
