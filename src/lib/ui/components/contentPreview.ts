import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import type { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import type KleptoExtension from '../../../extension.js';
import { ActiveState, getPreviewCacheFile } from '../../common/constants.js';
import { enumParamSpec, flagsParamSpec, registerClass } from '../../common/gjs.js';
import { Icon, loadIcon } from '../../common/icons.js';
import { BackgroundSize, FilePreviewType } from '../../common/settings.js';
import { CodeLabel, type CodeLabelConstructorProps } from './codeLabel.js';

export const FileType = {
	Unknown: 'Unknown',
	Directory: 'Directory',
	Text: 'Text',
	Image: 'Image',
	Audio: 'Audio',
	Video: 'Video',
} as const;

export type FileType = (typeof FileType)[keyof typeof FileType];

@registerClass()
export class ContentPreview extends St.BoxLayout {
	constructor() {
		super({
			style_class: 'content-preview',
			orientation: Clutter.Orientation.VERTICAL,
			x_expand: true,
			y_expand: true,
		});
	}
}

// Largest image edge passed to St directly. Anything larger gets a cached
// downscaled copy, since St crashes the shell on textures past
// GL_MAX_TEXTURE_SIZE (see #161).
const MAX_PREVIEW_EDGE = 4096;
const PREVIEW_TARGET_EDGE = 1024;

Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.File.prototype, 'replace_async');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');
Gio._promisify(Gio.OutputStream.prototype, 'close_async');

// Promise-typed aliases for promisified functions whose gir types only
// describe the callback form.
const newFromStreamAtScale = GdkPixbuf.Pixbuf.new_from_stream_at_scale_async as unknown as (
	stream: Gio.InputStream,
	width: number,
	height: number,
	preserveAspectRatio: boolean,
	cancellable: Gio.Cancellable | null,
) => Promise<GdkPixbuf.Pixbuf>;

const saveToStreamPng = (
	pixbuf: GdkPixbuf.Pixbuf,
	stream: Gio.OutputStream,
	cancellable: Gio.Cancellable | null,
): Promise<boolean> =>
	new Promise((resolve, reject) => {
		pixbuf.save_to_streamv_async(stream, 'png', [], [], cancellable, (_source, result) => {
			try {
				resolve(GdkPixbuf.Pixbuf.save_to_stream_finish(result));
			} catch (error) {
				reject(error);
			}
		});
	});

// Generates a downscaled preview without ever blocking the compositor: the
// read, the scaled decode, and the cache write are all asynchronous. Returns
// the original file when it is small enough, the cached copy otherwise, or
// null when no preview can be produced.
async function ensurePreviewFile(
	ext: Extension,
	image: Gio.File,
	cancellable: Gio.Cancellable,
): Promise<Gio.File | null> {
	try {
		const preview = getPreviewCacheFile(ext, image.get_uri());
		if (preview.query_exists(null)) return preview;

		const dir = preview.get_parent()!;
		if (!dir.query_exists(null)) dir.make_directory_with_parents(null);

		const stream = await image.read_async(GLib.PRIORITY_DEFAULT, cancellable);
		const pixbuf = await newFromStreamAtScale(stream, PREVIEW_TARGET_EDGE, PREVIEW_TARGET_EDGE, true, cancellable);
		const out = await preview.replace_async(
			null,
			false,
			Gio.FileCreateFlags.REPLACE_DESTINATION,
			GLib.PRIORITY_DEFAULT,
			cancellable,
		);
		try {
			await saveToStreamPng(pixbuf, out, cancellable);
		} finally {
			await out.close_async(GLib.PRIORITY_DEFAULT, cancellable);
		}
		return preview;
	} catch {
		return null;
	}
}

@registerClass({
	Properties: {
		'background-size': enumParamSpec(
			'background-size',
			GObject.ParamFlags.READWRITE,
			BackgroundSize,
			BackgroundSize.Cover,
		),
		'active': flagsParamSpec('active', GObject.ParamFlags.WRITABLE, ActiveState, ActiveState.None),
	},
})
export class ImagePreview extends ContentPreview {
	private _backgroundSize: BackgroundSize = BackgroundSize.Cover;
	private _ratio: number | null = null;
	private _effect?: Clutter.BrightnessContrastEffect;
	private _cancellable: Gio.Cancellable | null = null;

	constructor(ext: Extension, image: Gio.File) {
		super();

		this.add_style_class_name('image-preview');

		if (image.query_exists(null)) {
			try {
				const [, width, height] = GdkPixbuf.Pixbuf.get_file_info(image.get_path()!);
				if (width <= 0 || height <= 0) {
					this.showMissingImage(ext);
					return;
				}
				this._ratio = height / width;

				// Small images load synchronously; oversized ones show a
				// placeholder first and swap in the cached preview when ready.
				if (width <= MAX_PREVIEW_EDGE && height <= MAX_PREVIEW_EDGE) {
					this.addImageBox(image);
					return;
				}

				this._cancellable = new Gio.Cancellable();
				const cancellable = this._cancellable;
				this.showMissingImage(ext, false);
				ensurePreviewFile(ext, image, cancellable)
					.then((preview) => {
						if (!preview || cancellable.is_cancelled()) return;
						this.remove_all_children();
						this.remove_style_class_name('missing-image');
						this.addImageBox(preview);
					})
					.catch(() => {});
				return;
			} catch {
				// Ignore
			}
		}

		this.showMissingImage(ext);
	}

	private addImageBox(image: Gio.File) {
		const imageBox = new St.Widget({
			style_class: 'image-box',
			x_align: Clutter.ActorAlign.FILL,
			y_align: Clutter.ActorAlign.FILL,
			x_expand: true,
			y_expand: true,
			style: `background-image: url("${image.get_uri()}");`,
		});
		this.add_child(imageBox);

		this._effect = new Clutter.BrightnessContrastEffect();
		imageBox.add_effect(this._effect);
	}

	private showMissingImage(ext: Extension, setRatio: boolean = true) {
		if (setRatio) this._ratio = null;
		this.add_style_class_name('missing-image');
		this.add_child(
			new St.Icon({
				gicon: loadIcon(ext, Icon.MissingImage),
				x_align: Clutter.ActorAlign.CENTER,
				y_align: Clutter.ActorAlign.CENTER,
				x_expand: true,
				y_expand: true,
				min_height: 0,
			}),
		);
	}

	override destroy() {
		this._cancellable?.cancel();
		this._cancellable = null;

		super.destroy();
	}

	get backgroundSize() {
		return this._backgroundSize;
	}

	set backgroundSize(backgroundSize: BackgroundSize) {
		this._backgroundSize = backgroundSize;
		this.notify('background-size');

		if (backgroundSize === BackgroundSize.Cover) {
			this.remove_style_class_name('contain');
		} else {
			this.add_style_class_name('contain');
		}
	}

	set active(active: ActiveState) {
		if (!this._effect) return;

		if ((active & ActiveState.Active) > 0) {
			this._effect.set_brightness(0.2);
		} else if ((active & ActiveState.FocusHover) === (ActiveState.FocusHover as number)) {
			this._effect.set_brightness(0.1);
		} else if (active & ActiveState.Focus || active & ActiveState.Hover) {
			this._effect.set_brightness(0.05);
		} else {
			this._effect.enabled = false;
			return;
		}

		this._effect.enabled = true;
	}

	override vfunc_get_preferred_height(for_width: number): [number, number] {
		if (this._ratio === null) return super.vfunc_get_preferred_height(for_width);

		const [min] = super.vfunc_get_preferred_height(for_width);
		return [min, Math.round(for_width * Math.clamp(this._ratio, 0.3, 1))];
	}
}

@registerClass()
export class ThumbnailPreview extends ImagePreview {}

@registerClass({
	Properties: {
		'syntax-highlighting': GObject.ParamSpec.boolean(
			'syntax-highlighting',
			null,
			null,
			GObject.ParamFlags.READWRITE,
			true,
		),
		'show-line-numbers': GObject.ParamSpec.boolean(
			'show-line-numbers',
			null,
			null,
			GObject.ParamFlags.READWRITE,
			true,
		),
		'tab-width': GObject.ParamSpec.int('tab-width', null, null, GObject.ParamFlags.READWRITE, 1, 8, 4),
	},
})
export class TextPreview extends ContentPreview {
	declare syntaxHighlighting: boolean;
	declare showLineNumbers: boolean;
	declare tabWidth: number;

	constructor(ext: KleptoExtension, text: string, language?: string) {
		super();

		this.add_style_class_name('text-preview');

		const props: Partial<CodeLabelConstructorProps> = { code: text };
		if (language) props.language = { id: language, name: language };
		const label = new CodeLabel(ext, props);
		this.add_child(label);

		this.bind_property('syntax-highlighting', label, 'syntax-highlighting', GObject.BindingFlags.DEFAULT);
		this.bind_property('show-line-numbers', label, 'show-line-numbers', GObject.BindingFlags.DEFAULT);
		this.bind_property('tab-width', label, 'tab-width', GObject.BindingFlags.DEFAULT);
	}
}

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');

/**
 * Creates a text preview by reading the first 4096 bytes
 * @returns The text preview
 */
async function createTextPreview(ext: KleptoExtension, file: Gio.File): Promise<TextPreview> {
	const extension = file.get_uri().match(/\.(\w+)$/)?.[1];
	const stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
	const bytes = await stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null);
	const text = new TextDecoder().decode(bytes.toArray());
	return new TextPreview(ext, text, extension);
}

/**
 * Gets the thumbnail for a file
 * @param file The file to get the thumbnail for
 * @returns The thumbnail or null if no thumbnail was found
 */
async function tryGetThumbnail(file: Gio.File): Promise<Gio.File | null> {
	const uri = file.get_uri();
	const md5 = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uri, uri.length);

	const homeDir = GLib.get_home_dir();
	const thumbnailDir = Gio.File.new_build_filenamev([homeDir, '.cache', 'thumbnails']);

	try {
		const enumerator = await thumbnailDir.enumerate_children_async(
			'standard::*',
			Gio.FileQueryInfoFlags.NONE,
			GLib.PRIORITY_DEFAULT,
			null,
		);
		for await (const f of enumerator) {
			if (f.get_file_type() !== Gio.FileType.DIRECTORY) continue;

			const thumbnailFile = thumbnailDir.get_child(f.get_name()).get_child(`${md5}.png`);
			if (thumbnailFile.query_exists(null)) {
				return thumbnailFile;
			}
		}
	} catch {
		return null;
	}

	return null;
}

/**
 * Gets the content type of a file
 * @param file The file to guess the content type of
 * @returns The content type or null if no content type was found
 */
async function getContentType(file: Gio.File): Promise<string | null> {
	const info = await file.query_info_async(
		'standard::content-type',
		Gio.FileQueryInfoFlags.NONE,
		GLib.PRIORITY_DEFAULT,
		null,
	);
	const contentType = info.get_content_type();
	if (contentType !== null) {
		return contentType;
	}

	let data: GLib.Bytes | null = null;
	try {
		const stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
		data = await stream.read_bytes_async(64, GLib.PRIORITY_DEFAULT, null);
	} catch {
		return null;
	}

	return Gio.content_type_guess(file.get_path(), data?.toArray())[0];
}

/**
 * Gets the file type for a file
 * @param file The file to find the file type for
 * @returns The file type and a Gio.File if a thumbnail was found for the file
 */
export async function getFileType(file: Gio.File): Promise<[FileType, Gio.File | null]> {
	if (!file.query_exists(null)) return [FileType.Unknown, null];

	const fileType = file.query_file_type(Gio.FileQueryInfoFlags.NONE, null);
	if (fileType === Gio.FileType.DIRECTORY) return [FileType.Directory, null];

	if (fileType !== Gio.FileType.REGULAR) return [FileType.Unknown, null];

	// First check if the file has thumbnail
	const thumbnail = await tryGetThumbnail(file);

	// Then check if the file has any of the allowed types
	const contentType = await getContentType(file);
	if (!contentType) return [FileType.Unknown, thumbnail];

	// Check image before text since svg is also classified as text/plain
	if (Gio.content_type_is_a(contentType, 'image/*')) return [FileType.Image, thumbnail];
	if (Gio.content_type_is_a(contentType, 'audio/*')) return [FileType.Audio, thumbnail];
	if (Gio.content_type_is_a(contentType, 'video/*')) return [FileType.Video, thumbnail];
	if (Gio.content_type_is_a(contentType, 'text/plain')) return [FileType.Text, thumbnail];

	return [FileType.Unknown, thumbnail];
}

/**
 * Try to create a file preview for a file type
 * @param ext The extension
 * @param file The file to create a preview for
 * @param fileType The type of the file
 * @param thumbnail The thumbnail of the file if it exists
 * @returns the created file preview or null if either the file preview could not be created or if it is not allowed
 */
export async function tryCreateFilePreview(
	ext: KleptoExtension,
	file: Gio.File,
	fileType: FileType,
	thumbnail: Gio.File | null,
): Promise<ContentPreview | null> {
	const allowedTypes = ext.settings.get_child('file-item').get_flags('file-preview-types');

	try {
		if (!file.query_exists(null)) return null;

		switch (fileType) {
			case FileType.Text:
				return allowedTypes & FilePreviewType.Text ? await createTextPreview(ext, file) : null;
			case FileType.Image:
				return allowedTypes & FilePreviewType.Image ? new ImagePreview(ext, file) : null;
		}

		return thumbnail && allowedTypes & FilePreviewType.Thumbnail ? new ThumbnailPreview(ext, thumbnail) : null;
	} catch (error) {
		ext.logger.error(error);
		return null;
	}
}
