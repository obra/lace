// ABOUTME: Custom Ink App component with Tab cycling disabled for our focus model
// ABOUTME: Based on Ink v5.2.1 App.tsx but removes Tab/Shift+Tab cycling behavior

import React, {
	type ReactNode,
	createContext,
	useContext,
	useMemo,
	useState,
	useEffect,
	useCallback,
} from 'react';
import process from 'node:process';

/**
 * `<App>` is a top-level component for Ink apps.
 * It renders `<StdoutContext.Provider>`, `<StdinContext.Provider>` and `<FocusContext.Provider>` with default values.
 * It also handles Ctrl+C behavior and cursor visibility.
 */

type Props = {
	/**
	 * Children to render.
	 */
	children: ReactNode;

	/**
	 * If `true`, exit the app when Ctrl+C is pressed.
	 *
	 * @default true
	 */
	readonly exitOnCtrlC?: boolean;
};

type Stdout = {
	/**
	 * Write data to stdout.
	 */
	write: (data: string) => void;

	/**
	 * Columns count.
	 */
	columns: number;

	/**
	 * Rows count.
	 */
	rows: number;
};

type Stdin = {
	/**
	 * Stdin stream passed to the `render()` function.
	 */
	stdin: NodeJS.ReadableStream;

	/**
	 * Enable or disable raw mode on stdin.
	 */
	setRawMode: (isRawModeEnabled: boolean) => void;

	/**
	 * Check if stdin is in raw mode.
	 */
	isRawModeSupported: boolean;

	/**
	 * A boolean flag determining if the current `stdin` supports `setRawMode`.
	 * A component using `setRawMode` might want to use `isRawModeSupported` to nicely fall back in environments where raw mode is not supported.
	 */
	internal_exitOnCtrlC: boolean;
};

const StdoutContext = createContext<Stdout>({
	write() {},
	columns: 80,
	rows: 24,
});

const StdinContext = createContext<Stdin>({
	stdin: process.stdin,
	setRawMode() {},
	isRawModeSupported: false,
	internal_exitOnCtrlC: true,
});

type Focusable = {
	id: string;
	isActive: boolean;
};

type FocusContextType = {
	activeFocusId?: string;
	addFocusable: (id: string, options: {autoFocus: boolean}) => void;
	removeFocusable: (id: string) => void;
	activateFocusable: (id: string) => void;
	deactivateFocusable: (id: string) => void;
	enableFocus: () => void;
	disableFocus: () => void;
	focusNext: () => void;
	focusPrevious: () => void;
	focus: (id: string) => void;
};

const FocusContext = createContext<FocusContextType>({
	activeFocusId: undefined,
	addFocusable() {},
	removeFocusable() {},
	activateFocusable() {},
	deactivateFocusable() {},
	enableFocus() {},
	disableFocus() {},
	focusNext() {},
	focusPrevious() {},
	focus() {},
});

/**
 * `useStdout` is a React hook, which exposes stdout stream.
 */
export const useStdout = (): Stdout => useContext(StdoutContext);

/**
 * `useStdin` is a React hook, which exposes stdin stream.
 */
export const useStdin = (): Stdin => useContext(StdinContext);

/**
 * `useFocusManager` is a React hook, which exposes methods to manage focus.
 */
export const useFocusManager = (): FocusContextType => useContext(FocusContext);

/**
 * `useFocus` is a React hook, which allows a component to listen to focus events.
 */
export const useFocus = ({
	isActive = true,
	autoFocus = false,
	id,
}: {
	isActive?: boolean;
	autoFocus?: boolean;
	id?: string;
} = {}): {isFocused: boolean} => {
	const {activeFocusId, addFocusable, removeFocusable, activateFocusable, deactivateFocusable} = useFocusManager();

	const focusId = useMemo(() => id ?? Math.random().toString(), [id]);

	useEffect(() => {
		addFocusable(focusId, {autoFocus});

		return () => {
			removeFocusable(focusId);
		};
	}, [addFocusable, autoFocus, focusId, removeFocusable]);

	useEffect(() => {
		if (isActive) {
			activateFocusable(focusId);
		} else {
			deactivateFocusable(focusId);
		}
	}, [activateFocusable, deactivateFocusable, focusId, isActive]);

	return {
		isFocused: activeFocusId === focusId,
	};
};

export default function App({children, exitOnCtrlC = true}: Props) {
	const [isFocusEnabled, setIsFocusEnabled] = useState(true);
	const [activeFocusId, setActiveFocusId] = useState<string | undefined>();
	const [focusables, setFocusables] = useState<Focusable[]>([]);

	const stdout = useMemo(
		() => ({
			write: process.stdout.write.bind(process.stdout),
			columns: process.stdout.columns ?? 80,
			rows: process.stdout.rows ?? 24,
		}),
		[],
	);

	const stdin = useMemo(
		() => ({
			stdin: process.stdin,
			setRawMode: (isRawModeEnabled: boolean) => {
				if (process.stdin.setRawMode) {
					process.stdin.setRawMode(isRawModeEnabled);
				}
			},
			isRawModeSupported: Boolean(process.stdin.setRawMode),
			internal_exitOnCtrlC: exitOnCtrlC,
		}),
		[exitOnCtrlC],
	);

	const addFocusable = useCallback(
		(id: string, {autoFocus}: {autoFocus: boolean}) => {
			setFocusables(previousFocusables => {
				if (previousFocusables.some(focusable => focusable.id === id)) {
					return previousFocusables;
				}

				return [
					...previousFocusables,
					{
						id,
						isActive: true,
					},
				];
			});

			if (autoFocus) {
				setActiveFocusId(id);
			}
		},
		[],
	);

	const removeFocusable = useCallback((id: string) => {
		setFocusables(previousFocusables =>
			previousFocusables.filter(focusable => focusable.id !== id),
		);
	}, []);

	const activateFocusable = useCallback((id: string) => {
		setFocusables(previousFocusables =>
			previousFocusables.map(focusable => {
				if (focusable.id !== id) {
					return focusable;
				}

				return {
					...focusable,
					isActive: true,
				};
			}),
		);
	}, []);

	const deactivateFocusable = useCallback((id: string) => {
		setFocusables(previousFocusables =>
			previousFocusables.map(focusable => {
				if (focusable.id !== id) {
					return focusable;
				}

				return {
					...focusable,
					isActive: false,
				};
			}),
		);
	}, []);

	const enableFocus = useCallback(() => {
		setIsFocusEnabled(true);
	}, []);

	const disableFocus = useCallback(() => {
		setIsFocusEnabled(false);
	}, []);

	const focusNext = useCallback(() => {
		if (!isFocusEnabled) {
			return;
		}

		const activeFocusables = focusables.filter(focusable => focusable.isActive);

		if (activeFocusables.length === 0) {
			return;
		}

		const currentFocusIndex = activeFocusables.findIndex(
			focusable => focusable.id === activeFocusId,
		);

		let nextFocusId: string;

		if (currentFocusIndex === -1) {
			nextFocusId = activeFocusables[0]!.id;
		} else if (currentFocusIndex + 1 >= activeFocusables.length) {
			nextFocusId = activeFocusables[0]!.id;
		} else {
			nextFocusId = activeFocusables[currentFocusIndex + 1]!.id;
		}

		setActiveFocusId(nextFocusId);
	}, [isFocusEnabled, focusables, activeFocusId]);

	const focusPrevious = useCallback(() => {
		if (!isFocusEnabled) {
			return;
		}

		const activeFocusables = focusables.filter(focusable => focusable.isActive);

		if (activeFocusables.length === 0) {
			return;
		}

		const currentFocusIndex = activeFocusables.findIndex(
			focusable => focusable.id === activeFocusId,
		);

		let previousFocusId: string;

		if (currentFocusIndex === -1) {
			previousFocusId = activeFocusables[activeFocusables.length - 1]!.id;
		} else if (currentFocusIndex === 0) {
			previousFocusId = activeFocusables[activeFocusables.length - 1]!.id;
		} else {
			previousFocusId = activeFocusables[currentFocusIndex - 1]!.id;
		}

		setActiveFocusId(previousFocusId);
	}, [isFocusEnabled, focusables, activeFocusId]);

	const focus = useCallback((id: string) => {
		const focusable = focusables.find(focusableItem => focusableItem.id === id);

		if (focusable && focusable.isActive) {
			setActiveFocusId(id);
		}
	}, [focusables]);

	const focusManager = useMemo(
		() => ({
			activeFocusId,
			addFocusable,
			removeFocusable,
			activateFocusable,
			deactivateFocusable,
			enableFocus,
			disableFocus,
			focusNext,
			focusPrevious,
			focus,
		}),
		[
			activeFocusId,
			addFocusable,
			removeFocusable,
			activateFocusable,
			deactivateFocusable,
			enableFocus,
			disableFocus,
			focusNext,
			focusPrevious,
			focus,
		],
	);

	// NOTE: Removed Ink's Tab/Shift+Tab handling here
	// Original code had useInput hook that handled Tab cycling
	// We want manual focus control only

	return (
		<StdoutContext.Provider value={stdout}>
			<StdinContext.Provider value={stdin}>
				<FocusContext.Provider value={focusManager}>
					{children}
				</FocusContext.Provider>
			</StdinContext.Provider>
		</StdoutContext.Provider>
	);
}