import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {
	type Action,
	type ActionConfig,
	type ActionSubmenu,
	instanceofAction,
	instanceofActionSubmenu,
} from '../../common/actions.js';
import { ItemType } from '../../common/constants.js';
import { registerClass } from '../../common/gjs.js';

function validType(type: ItemType, types: ItemType[] | undefined | null): boolean {
	if (types == null || types.length === 0) return true;
	return types.includes(type);
}

@registerClass({
	Properties: {
		id: GObject.ParamSpec.string('id', null, null, GObject.ParamFlags.READABLE, ''),
		path: GObject.ParamSpec.string('path', null, null, GObject.ParamFlags.READABLE, ''),
	},
})
class ActionListItem extends GObject.Object {
	constructor(
		readonly id: string | null,
		readonly name: string,
		readonly submenu: string | null = null,
	) {
		super();
	}

	get path() {
		return this.submenu ? `${this.submenu} › ${this.name}` : this.name;
	}
}

@registerClass({
	Properties: {
		'default-value': GObject.ParamSpec.string('default-value', null, null, GObject.ParamFlags.READABLE, ''),
	},
})
class ActionDefault extends Adw.ComboRow {
	constructor(
		private type: ItemType,
		title: string,
		actions: (Action | ActionSubmenu)[],
		defaultValue: string | null = null,
	) {
		super({ title });

		this.expression = Gtk.PropertyExpression.new(ActionListItem.$gtype, null, 'path');
		this.update(actions, defaultValue);

		this.connect('notify::selected-item', () => this.notify('default-value'));
	}

	get defaultValue() {
		return (this.selected_item as ActionListItem | null)?.id ?? null;
	}

	update(actions: (Action | ActionSubmenu)[], id: string | null = null) {
		id ??= this.defaultValue;
		let selected = 0;

		const list = new Gio.ListStore({ item_type: ActionListItem.$gtype });
		list.append(new ActionListItem(null, _('None')));

		for (const action of actions) {
			if (instanceofAction(action)) {
				if (validType(this.type, action.types)) {
					if (action.id === id) selected = list.n_items;
					list.append(new ActionListItem(action.id, action.name));
				}
			} else if (instanceofActionSubmenu(action)) {
				for (const subAction of action.actions) {
					if (validType(this.type, subAction.types)) {
						if (subAction.id === id) selected = list.n_items;
						list.append(new ActionListItem(subAction.id, subAction.name, action.name));
					}
				}
			}
		}
		this.model = list;
		this.selected = selected;
	}
}

@registerClass({
	Properties: {
		defaults: GObject.ParamSpec.jsobject('defaults', null, null, GObject.ParamFlags.READABLE),
	},
})
export class ActionDefaultsPage extends Adw.NavigationPage {
	_defaults: Partial<Record<ItemType, string>>;

	private readonly _textDefault: ActionDefault;
	private readonly _codeDefault: ActionDefault;
	private readonly _imageDefault: ActionDefault;
	private readonly _fileDefault: ActionDefault;
	private readonly _filesDefault: ActionDefault;
	private readonly _linkDefault: ActionDefault;
	private readonly _characterDefault: ActionDefault;
	private readonly _colorDefault: ActionDefault;

	constructor(config: ActionConfig) {
		super({
			title: _('Default Actions'),
		});

		config.defaults ??= {};
		this._defaults = config.defaults;

		const toolbarView = new Adw.ToolbarView();
		toolbarView.add_top_bar(new Adw.HeaderBar());
		this.child = toolbarView;

		const page = new Adw.PreferencesPage();
		toolbarView.content = page;

		// Defaults
		const defaults = new Adw.PreferencesGroup({
			title: _('Default Actions'),
		});
		page.add(defaults);

		this._textDefault = new ActionDefault(ItemType.Text, _('Text'), config.actions, config.defaults?.Text);
		this.connectDefault(ItemType.Text, this._textDefault);
		defaults.add(this._textDefault);

		this._codeDefault = new ActionDefault(ItemType.Code, _('Code'), config.actions, config.defaults?.Code);
		this.connectDefault(ItemType.Code, this._codeDefault);
		defaults.add(this._codeDefault);

		this._imageDefault = new ActionDefault(ItemType.Image, _('Image'), config.actions, config.defaults?.Image);
		this.connectDefault(ItemType.Image, this._imageDefault);
		defaults.add(this._imageDefault);

		this._fileDefault = new ActionDefault(ItemType.File, _('File'), config.actions, config.defaults?.File);
		this.connectDefault(ItemType.File, this._fileDefault);
		defaults.add(this._fileDefault);

		this._filesDefault = new ActionDefault(ItemType.Files, _('Files'), config.actions, config.defaults?.Files);
		this.connectDefault(ItemType.Files, this._filesDefault);
		defaults.add(this._filesDefault);

		this._linkDefault = new ActionDefault(ItemType.Link, _('Link'), config.actions, config.defaults?.Link);
		this.connectDefault(ItemType.Link, this._linkDefault);
		defaults.add(this._linkDefault);

		this._characterDefault = new ActionDefault(
			ItemType.Character,
			_('Character'),
			config.actions,
			config.defaults?.Character,
		);
		this.connectDefault(ItemType.Character, this._characterDefault);
		defaults.add(this._characterDefault);

		this._colorDefault = new ActionDefault(ItemType.Color, _('Color'), config.actions, config.defaults?.Color);
		this.connectDefault(ItemType.Color, this._colorDefault);
		defaults.add(this._colorDefault);
	}

	get defaults() {
		return this._defaults;
	}

	setDefaults(config: ActionConfig) {
		this._defaults = config.defaults ?? {};

		this._textDefault.update(config.actions, this._defaults?.Text);
		this._codeDefault.update(config.actions, this._defaults?.Code);
		this._imageDefault.update(config.actions, this._defaults?.Image);
		this._fileDefault.update(config.actions, this._defaults?.File);
		this._filesDefault.update(config.actions, this._defaults?.Files);
		this._linkDefault.update(config.actions, this._defaults?.Link);
		this._characterDefault.update(config.actions, this._defaults?.Character);
		this._colorDefault.update(config.actions, this._defaults?.Color);
	}

	update(config: ActionConfig) {
		this._textDefault.update(config.actions);
		this._codeDefault.update(config.actions);
		this._imageDefault.update(config.actions);
		this._fileDefault.update(config.actions);
		this._filesDefault.update(config.actions);
		this._linkDefault.update(config.actions);
		this._characterDefault.update(config.actions);
		this._colorDefault.update(config.actions);
	}

	private connectDefault(type: ItemType, action: ActionDefault) {
		action.connect('notify::default-value', () => {
			const value = action.defaultValue;
			if (value) {
				this._defaults[type] = value;
			} else {
				delete this._defaults[type];
			}

			this.notify('defaults');
		});
	}
}
