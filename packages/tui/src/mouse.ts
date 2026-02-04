export type MouseModifiers = {
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
};

export type MouseScrollEvent = {
	type: "scroll";
	/** -1 = up, 1 = down */
	delta: number;
	x: number;
	y: number;
	modifiers: MouseModifiers;
};

export type MouseEvent = MouseScrollEvent;

const SGR_MOUSE_REGEX = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/;

export function parseMouseEvent(data: string): MouseEvent | null {
	const match = data.match(SGR_MOUSE_REGEX);
	if (!match) return null;

	const code = Number.parseInt(match[1] ?? "", 10);
	const x = Number.parseInt(match[2] ?? "", 10);
	const y = Number.parseInt(match[3] ?? "", 10);
	if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}

	const isWheel = (code & 64) !== 0;
	if (!isWheel) return null;

	const wheel = code & 3;
	let delta = 0;
	if (wheel === 0) {
		delta = -1;
	} else if (wheel === 1) {
		delta = 1;
	} else {
		return null;
	}

	return {
		type: "scroll",
		delta,
		x,
		y,
		modifiers: {
			shift: (code & 4) !== 0,
			alt: (code & 8) !== 0,
			ctrl: (code & 16) !== 0,
		},
	};
}
