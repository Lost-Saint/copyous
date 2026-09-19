import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import type { ActionSubmenu } from '../../common/actions.js';
import { registerClass } from '../../common/gjs.js';

@registerClass({
	Properties: {
		'action-submenu': GObject.ParamSpec.jsobject('action-submenu', null, null, GObject.ParamFlags.READABLE),
	},
})
export class ActionSubmenuDialog extends Adw.AlertDialog {
	private readonly _actionSubmenu: ActionSubmenu;
	private readonly _suggestedId: string;

	private readonly _nameRow: Adw.EntryRow;

	constructor(actionSubmenu: ActionSubmenu | null, heading: string, suggestedId: string, suggestedLabel: string) {
		super({
			heading,
		});

		this._suggestedId = suggestedId;

		actionSubmenu ??= {
			name: '',
			actions: [],
		};
		this._actionSubmenu = actionSubmenu;

		this.add_response('cancel', _('Cancel'));
		this.set_close_response('cancel');
		this.add_response(suggestedId, suggestedLabel);
		this.set_response_appearance(suggestedId, Adw.ResponseAppearance.SUGGESTED);
		this.set_response_enabled(suggestedId, false);

		// Form
		const box = new Gtk.ListBox({
			css_classes: ['boxed-list'],
			selection_mode: Gtk.SelectionMode.NONE,
		});
		this.extra_child = box;

		this._nameRow = new Adw.EntryRow({ title: _('Name'), text: actionSubmenu.name });
		box.append(this._nameRow);

		// Connect signals
		this._nameRow.connect('notify::text', this.updateEnabled.bind(this));
	}

	get actionSubmenu() {
		return this._actionSubmenu;
	}

	on_response(response: string) {
		if (response === this._suggestedId && this.actionSubmenu !== null) {
			this.actionSubmenu.name = this._nameRow.text;
			this.notify('action-submenu');
		}
	}

	updateEnabled() {
		this.set_response_enabled(this._suggestedId, this._nameRow.text !== '');
	}
}

@registerClass()
export class AddActionSubmenuDialog extends ActionSubmenuDialog {
	constructor(actionSubmenu: ActionSubmenu | null) {
		super(actionSubmenu, _('Add Submenu'), 'add', _('Add'));
	}
}

@registerClass()
export class EditActionSubmenuDialog extends ActionSubmenuDialog {
	constructor(actionSubmenu: ActionSubmenu | null) {
		super(actionSubmenu, _('Edit Submenu'), 'edit', _('Edit'));
	}
}
