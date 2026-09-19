import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

// Run the real clipboard and keyboard classes with controlled GNOME boundaries.
const timeouts = new Map();
const inputHandlers = new Map();
const keys = [];
let startingUp = false;
let deviceCount = 0;
let nextTimeoutId = 1;
const selection = { connect: mock(() => 1), disconnect: mock(() => {}) };
const clipboard = { set_text: mock(() => {}) };
const purpose = { NORMAL: 0, TERMINAL: 1 };
const inputMethod = {
	content_purpose: purpose.NORMAL,
	connectObject(_signal, callback, owner) {
		inputHandlers.set(owner, callback);
	},
	disconnectObject(owner) {
		inputHandlers.delete(owner);
	},
};
const device = {
	notify_keyval(_time, key, state) {
		keys.push([key, state]);
	},
};
const seat = {
	create_virtual_device() {
		if (startingUp) throw new Error('Virtual keyboard created during Shell startup');
		deviceCount++;
		return device;
	},
};

mock.module('gi://Clutter', () => ({
	default: {
		InputContentPurpose: purpose,
		InputDeviceType: { KEYBOARD_DEVICE: 1 },
		KeyState: { PRESSED: 1, RELEASED: 0 },
		KEY_Control_L: 'Control',
		KEY_Shift_L: 'Shift',
		KEY_Insert: 'Insert',
		get_default_backend: () => ({ get_default_seat: () => seat }),
		get_current_event_time: () => 1,
	},
}));
mock.module('resource:///org/gnome/shell/ui/main.js', () => ({ inputMethod }));
mock.module('gi://Gio', () => ({
	default: { _promisify() {}, File: class {}, MemoryOutputStream: class {} },
}));
mock.module('gi://GLib', () => ({
	default: {
		PRIORITY_DEFAULT: 0,
		SOURCE_REMOVE: false,
		ChecksumType: { MD5: 0 },
		compute_checksum_for_string: (_type, text) => text,
		timeout_add(_priority, _delay, callback) {
			const id = nextTimeoutId++;
			timeouts.set(id, callback);
			return id;
		},
		source_remove: (id) => timeouts.delete(id),
	},
}));
mock.module('gi://GObject', () => ({
	default: {
		Object: class {
			emit() {}
		},
	},
}));
mock.module('gi://Meta', () => ({ default: { SelectionSource: class {} } }));
mock.module('gi://St', () => ({
	default: { Clipboard: { get_default: () => clipboard }, ClipboardType: { CLIPBOARD: 0, PRIMARY: 1 } },
}));
mock.module('../src/lib/common/constants.js', () => ({ ItemType: { Text: 'text' }, getImagesPath() {} }));
mock.module('../src/lib/common/gjs.js', () => ({ registerClass: () => (cls) => cls }));
mock.module('../src/lib/database/database.js', () => ({ ClipboardEntry: class {}, FileOperation: { Copy: 'copy' } }));

const { ClipboardManager } = await import('../src/lib/misc/clipboard.ts');
const previousDisplay = globalThis.display;
globalThis.display = { get_selection: () => selection };
afterAll(() => {
	if (previousDisplay === undefined) delete globalThis.display;
	else globalThis.display = previousDisplay;
});

beforeEach(() => {
	startingUp = false;
	deviceCount = 0;
	keys.length = 0;
	timeouts.clear();
	inputHandlers.clear();
	inputMethod.content_purpose = purpose.NORMAL;
	selection.disconnect.mockClear();
	clipboard.set_text.mockClear();
});

function createManager() {
	return new ClipboardManager({ settings: { get_boolean: () => false } }, {});
}

function runPaste() {
	expect(timeouts.size).toBe(1);
	for (const [id, callback] of timeouts) {
		timeouts.delete(id);
		expect(callback()).toBe(false);
	}
}

test('startup and copying do not create a virtual keyboard', () => {
	startingUp = true;
	const manager = createManager();
	manager.copyText('copied during startup');
	expect(clipboard.set_text).toHaveBeenCalledWith(0, 'copied during startup');
	expect(deviceCount).toBe(0);
	expect(inputHandlers.size).toBe(0);
	manager.destroy();
	expect(selection.disconnect).toHaveBeenCalledWith(1);
});

test('disabling before the first paste cancels pending keyboard creation', () => {
	const manager = createManager();
	manager.pasteText('cancelled');
	expect(deviceCount).toBe(0);
	manager.destroy();
	expect(timeouts.size).toBe(0);
	expect(deviceCount).toBe(0);
	expect(inputHandlers.size).toBe(0);
});

test('the first paste uses the already focused terminal purpose', () => {
	inputMethod.content_purpose = purpose.TERMINAL;
	const manager = createManager();
	manager.pasteText('terminal');
	runPaste();
	expect(deviceCount).toBe(1);
	expect(keys).toEqual([
		['Control', 1],
		['Shift', 1],
		['Insert', 1],
		['Insert', 0],
		['Shift', 0],
		['Control', 0],
	]);
	manager.destroy();
	expect(inputHandlers.size).toBe(0);
});

test('later pastes reuse the keyboard and track input purpose changes', () => {
	const manager = createManager();
	manager.pasteText('normal');
	runPaste();
	expect(keys).toEqual([
		['Shift', 1],
		['Insert', 1],
		['Insert', 0],
		['Shift', 0],
	]);
	keys.length = 0;
	inputMethod.content_purpose = purpose.TERMINAL;
	for (const callback of inputHandlers.values()) callback(inputMethod);
	manager.pasteText('terminal');
	runPaste();
	expect(deviceCount).toBe(1);
	expect(keys).toEqual([
		['Control', 1],
		['Shift', 1],
		['Insert', 1],
		['Insert', 0],
		['Shift', 0],
		['Control', 0],
	]);
	manager.destroy();
	expect(inputHandlers.size).toBe(0);
});
