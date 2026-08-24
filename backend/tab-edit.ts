import { checkFilename } from "./util.ts";

interface TabEditSession {
    tabId: string;
    userId: string;
    filePath: string;
    updatedAt: number;
}

const maxDraftBytes = 50 * 1024 * 1024;
const maxDraftAgeMs = 24 * 60 * 60 * 1000;
const sessions = new Map<string, TabEditSession>();

async function removeSession(token: string, session: TabEditSession): Promise<void> {
    sessions.delete(token);
    try {
        await Deno.remove(session.filePath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
        }
    }
}

async function cleanupExpiredSessions(): Promise<void> {
    const cutoff = Date.now() - maxDraftAgeMs;
    await Promise.all(Array.from(sessions.entries()).filter(([, session]) => session.updatedAt < cutoff).map(([token, session]) => removeSession(token, session)));
}

function requireSession(tabId: string, token: string, userId?: string): TabEditSession {
    checkFilename(tabId);
    const session = sessions.get(token);
    if (!session || session.tabId !== tabId || userId !== undefined && session.userId !== userId) {
        throw new Error("Tab edit session not found");
    }
    return session;
}

export async function createTabEditSession(tabId: string, userId: string, sourcePath: string): Promise<string> {
    checkFilename(tabId);
    await cleanupExpiredSessions();
    const token = crypto.randomUUID();
    const filePath = await Deno.makeTempFile({ prefix: "its-mytabs-tab-edit-", suffix: ".gp" });
    try {
        await Deno.copyFile(sourcePath, filePath);
        sessions.set(token, { tabId, userId, filePath, updatedAt: Date.now() });
        return token;
    } catch (error) {
        await Deno.remove(filePath).catch(() => undefined);
        throw error;
    }
}

export function getTabEditSessionPath(tabId: string, token: string, userId?: string): string {
    return requireSession(tabId, token, userId).filePath;
}

export async function updateTabEditSession(tabId: string, token: string, userId: string, data: Uint8Array): Promise<void> {
    if (data.length === 0 || data.length > maxDraftBytes) {
        throw new Error(`Tab draft must be between 1 and ${maxDraftBytes} bytes`);
    }
    const session = requireSession(tabId, token, userId);
    await Deno.writeFile(session.filePath, data);
    session.updatedAt = Date.now();
}

export async function readTabEditSession(tabId: string, token: string, userId: string): Promise<Uint8Array> {
    return await Deno.readFile(requireSession(tabId, token, userId).filePath);
}

export async function discardTabEditSession(tabId: string, token: string, userId: string): Promise<void> {
    const session = requireSession(tabId, token, userId);
    await removeSession(token, session);
}
