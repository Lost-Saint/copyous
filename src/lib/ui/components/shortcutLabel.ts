import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { registerClass } from '../../common/gjs.js';

@registerClass({
	Properties: {
		shortcut: GObject.ParamSpec.string('shortcuts', null, null, GObject.ParamFlags.READWRITE, null),
	},
})
export class ShortcutLabel extends St.Label {
	private _shortcut: string;

	constructor(shortcut: string, props: Partial<St.Label.ConstructorProps>) {
		super(props);

		this._shortcut = shortcut;
		this.text = ShortcutLabel.shortcutToLabel(shortcut);
	}

	get shortcut(): string {
		return this._shortcut;
	}

	set shortcut(shortcut: string) {
		this._shortcut = shortcut;
		this.notify('shortcuts');

		this.text = ShortcutLabel.shortcutToLabel(shortcut);
	}

	private static shortcutToLabel(shortcut: string): string {
		return shortcut
			.split(' ')
			.map((s) =>
				s
					.replace(/(?<=^|>)(\w)/g, (_match, key: string) => key.toUpperCase())
					.replace(/<(\w+)>(?=(.?))/g, (_match, key: string, next: string) => {
						const plus = next.length > 0 ? '+' : '';
						switch (key.toLowerCase()) {
							case 'shift':
								return GLib.dpgettext2('gtk40', 'Keyboard label', 'Shift') + plus;
							case 'control':
								return GLib.dpgettext2('gtk40', 'Keyboard label', 'Ctrl') + plus;
							case 'alt':
								return GLib.dpgettext2('gtk40', 'Keyboard label', 'Alt') + plus;
							case 'meta':
								return GLib.dpgettext2('gtk40', 'Keyboard label', 'Meta') + plus;
							case 'super':
								return GLib.dpgettext2('gtk40', 'Keyboard label', 'Super') + plus;
							case 'hyper':
								return GLib.dpgettext2('gtk40', 'Keyboard label', 'Hyper') + plus;
							default:
								return key + plus;
						}
					})
					.replace('&', '+'),
			)
			.join(' ');
	}
}
