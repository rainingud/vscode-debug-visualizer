import {
	DataSource,
	EvaluationWatcher,
	EvaluationWatcherOptions,
} from "./DataSource";
import { observable, autorun, action } from "mobx";
import { Disposable } from "@hediet/std/disposable";
import { DataExtractorId } from "@hediet/debug-visualizer-data-extraction";
import { DataExtractionState, CompletionItem } from "../contract";
import { hotClass } from "@hediet/node-reload";
import { VsCodeDebuggerView } from "../VsCodeDebugger";
import { DataExtractionProviderFactory } from "./DataExtractionProvider/DataExtractionProvider";

@hotClass(module)
export class DataSourceImpl implements DataSource {
	public readonly dispose = Disposable.fn();
	private readonly watchers = new Set<ObservableEvaluationWatcher>();

	constructor(
		private readonly vsCodeDebuggerView: VsCodeDebuggerView,
		private readonly dataExtractionProviderFactory: DataExtractionProviderFactory
	) {
		this.dispose.track({
			dispose: autorun(() => {
				if (
					vsCodeDebuggerView.activeDebugSession &&
					vsCodeDebuggerView.activeFrameId !== undefined
				) {
					for (const w of this.watchers) {
						w.refresh();
					}
				}
			}),
		});
	}

	public createEvaluationWatcher(
		expression: string,
		options: EvaluationWatcherOptions
	): EvaluationWatcher {
		const w = new ObservableEvaluationWatcher(expression, this, options);
		this.watchers.add(w);
		this.refresh(w);
		return w;
	}

	public removeWatcher(w: ObservableEvaluationWatcher) {
		this.watchers.delete(w);
	}

	public async refresh(w: ObservableEvaluationWatcher): Promise<void> {
		const session = this.vsCodeDebuggerView.activeDebugSession;
		if (!session) {
			w._state = { kind: "noDebugSession" };
			return;
		}

		const frameId = this.vsCodeDebuggerView.activeFrameId;

		w._state = { kind: "loading" };

		const extractionProvider = this.dataExtractionProviderFactory.createDataExtractionProvider(
			session
		);
		if (!extractionProvider) {
			w._state = {
				kind: "error",
				message: `The debug adapter "${session.session.type}" is not supported.`,
			};
			return;
		}

		const result = await extractionProvider.evaluate({
			expression: w.expression,
			frameId,
			preferredExtractorId: w.preferredDataExtractor,
		});

		w._state = result;
	}

	public async getCompletions(
		text: string,
		column: number
	): Promise<CompletionItem[]> {
		const session = this.vsCodeDebuggerView.activeDebugSession;
		if (!session) {
			return [];
		}
		return await session.getCompletions({
			text,
			frameId: this.vsCodeDebuggerView.activeFrameId,
			column,
		});
	}
}

class ObservableEvaluationWatcher implements EvaluationWatcher {
	constructor(
		public readonly expression: string,
		private readonly source: DataSourceImpl,
		options: EvaluationWatcherOptions
	) {
		this._preferredDataExtractor = options.preferredDataExtractor;
	}

	@observable
	private _preferredDataExtractor: DataExtractorId | undefined = undefined;

	public get preferredDataExtractor(): DataExtractorId | undefined {
		return this._preferredDataExtractor;
	}

	@action
	public setPreferredDataExtractor(id: DataExtractorId | undefined): void {
		this._preferredDataExtractor = id;
		this.refresh();
	}

	public refresh(): void {
		this.source.refresh(this);
	}

	@observable
	public _state: DataExtractionState = { kind: "loading" };
	public get state(): DataExtractionState {
		return this._state;
	}

	public dispose(): void {
		this.source.removeWatcher(this);
	}
}
