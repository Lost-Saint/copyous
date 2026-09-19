import GObject from 'gi://GObject';

/**
 * GObject.registerClass wrapper for use with decorators.
 *
 * The inner call intentionally returns nothing: a decorator that returns a
 * value replaces the class type (and the new types describe a wrapper that
 * drops static members), while a void-returning decorator keeps the declared
 * class exactly as written. GObject.registerClass still runs for effect.
 */
export function registerClass<
	T extends new (
		// biome-ignore lint/suspicious/noExplicitAny: matches upstream Ctor shape.
		...args: any[]
	) => GObject.Object,
	Props extends { [key: string]: GObject.ParamSpec },
	Interfaces extends { $gtype: GObject.GType }[],
	Sigs extends {
		[key: string]: {
			param_types?: readonly GObject.GType[];
			[key: string]: unknown;
		};
	},
>(options?: GObject.MetaInfo<Props, Interfaces, Sigs>) {
	if (options) {
		return (cls: T) => {
			GObject.registerClass(options, cls);
		};
	} else {
		return (cls: T) => {
			GObject.registerClass(cls);
		};
	}
}

@registerClass({
	Properties: {
		jsobject: GObject.ParamSpec.jsobject('jsobject', null, null, GObject.ParamFlags.READABLE),
	},
})
export class JsObjectWrapper<T> extends GObject.Object {
	constructor(public jsobject: T) {
		super();
	}
}

export function int32ParamSpec(name: string, flags: GObject.ParamFlags, defaultValue: number): GObject.ParamSpec {
	return GObject.ParamSpec.int(name, null, null, flags, 0, 2147483647, defaultValue);
}

export function enumParamSpec(name: string, flags: GObject.ParamFlags, e: object, defaultValue: number) {
	const values = Object.values(e)
		.map((k) => +k)
		.filter((k) => Number.isInteger(k));

	const min = Math.min(...values);
	const max = Math.max(...values);
	return GObject.ParamSpec.int(name, null, null, flags, min, max, defaultValue);
}

export function flagsParamSpec(name: string, flags: GObject.ParamFlags, e: object, defaultValue: number) {
	const values = Object.values(e)
		.map((k) => +k)
		.filter((k) => Number.isInteger(k));

	const max = (2 << Math.log2(Math.floor(Math.max(...values)))) - 1;
	return GObject.ParamSpec.int(name, null, null, flags, 0, max, defaultValue);
}
