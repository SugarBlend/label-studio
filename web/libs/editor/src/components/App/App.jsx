/**
 * Libraries
 */
import React, { Component } from "react";
import { Result, Spin } from "antd";
import { getEnv, getRoot } from "mobx-state-tree";
import { observer, Provider } from "mobx-react";
import { QueryClientProvider } from "@tanstack/react-query";

/**
 * Core
 */
import { CommentsOverlay } from "../InteractiveOverlays/CommentsOverlay";
import { TreeValidation } from "../TreeValidation/TreeValidation";

/**
 * Tags
 */
import "../../tags/object";
import "../../tags/control";
import "../../tags/visual";
import "../../tags/Custom";

/**
 * Utils and common components
 */
import { Space } from "../../common/Space/Space";
import { Button } from "@humansignal/ui";
import { isStarterCloudPlan } from "@humansignal/core";
import { cn } from "../../utils/bem";
import { FF_BULK_ANNOTATION, FF_LSDV_4620_3_ML, FF_SIMPLE_INIT, isFF } from "../../utils/feature-flags";
import { reactCleaner } from "../../utils/reactCleaner";
import { isDefined, sortAnnotations } from "../../utils/utilities";
import { queryClient } from "@humansignal/core/lib/utils/query-client";
import { ToastProvider, ToastViewport } from "@humansignal/ui/lib/toast/toast";

/**
 * Components
 */
import { Annotation } from "./Annotation";
import { BottomBar } from "../BottomBar/BottomBar";
import Debug from "../Debug";
import { InstructionsModal } from "../InstructionsModal/InstructionsModal";
import { RelationsOverlay } from "../InteractiveOverlays/RelationsOverlay";
import Settings from "../Settings/Settings";
import { SideTabsPanels } from "../SidePanels/TabPanels/SideTabsPanels";
import { TopBar } from "../TopBar/TopBar";
import { ViewAll } from "./ViewAll";
import { Skeleton3D } from "../Skeleton3D/Skeleton3D";

/**
 * Styles
 */
import "./App.scss";

/**
 * Check if annotation has any tag that should be rendered in sidebar
 * Used to conditionally show the custom tab in the side panel
 * @returns {boolean|string} - false or the title of the tab that should be rendered in sidebar
 */
const hasTagInSidebar = (annotation) => {
  if (!annotation?.names) return false;
  for (const tag of annotation.names.values()) {
    if (tag.renderInSidebar) {
      return tag.sidebar;
    }
  }
  return false;
};

/**
 * App
 */
class App extends Component {
  relationsRef = React.createRef();

  componentDidMount() {
    // Hack to activate app hotkeys
    window.blur();
    document.body.focus();
  }

  renderSuccess() {
    return (
      <div className={cn("editor").toClassName()}>
        <Result status="success" title={getEnv(this.props.store).messages.DONE} />
      </div>
    );
  }

  renderNoAnnotation() {
    return (
      <div className={cn("editor").toClassName()}>
        <Result status="success" title={getEnv(this.props.store).messages.NO_COMP_LEFT} />
      </div>
    );
  }

  renderNothingToLabel(store) {
    return (
      <div
        className={cn("editor").toClassName()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          paddingBottom: "30vh",
        }}
      >
        <Result status="success" title={getEnv(this.props.store).messages.NO_NEXT_TASK} />
        <div className={cn("sub__result").toClassName()}>All tasks in the queue have been completed</div>
        {store.taskHistory.length > 0 && (
          <Button
            onClick={(e) => store.prevTask(e, true)}
            variant="neutral"
            className="mx-0 my-4"
            aria-label="Previous task"
          >
            Go to Previous Task
          </Button>
        )}
      </div>
    );
  }

  renderNoAccess() {
    return (
      <div className={cn("editor").toClassName()}>
        <Result status="warning" title={getEnv(this.props.store).messages.NO_ACCESS} />
      </div>
    );
  }

  renderConfigValidationException(store) {
    return (
      <div className={cn("main-view").toClassName()}>
        <div className={cn("main-view").elem("annotation").toClassName()}>
          <TreeValidation errors={this.props.store.annotationStore.validation} />
        </div>
      </div>
    );
  }

  renderLoader() {
    return <Result icon={<Spin size="large" />} />;
  }

  _renderUI(root, as, fallback = null) {
    const skeleton3d = getEnv(this.props.store).skeleton3d;

    if (!skeleton3d?.enabled && as.viewingAll && getRoot(as).hasInterface("annotations:view-all")) {
      return this.renderAllAnnotations();
    }

    // The 3D component must live outside of the annotation's changing key:
    // switching frames/annotations must not close its portal or reset its orbit.
    // The parent grid remains mounted even when a reconstruction is pending.
    return (
      <div
        className={`${cn("main-view").toClassName()}${skeleton3d?.enabled ? " main-view--skeleton3d" : ""}`}
        onScrollCapture={this._notifyScroll}
      >
        <div className={cn("main-view").elem("annotation").toClassName()}>
          {fallback ?? (root && as.selected ? (
            <>
              <Annotation root={root} annotation={as.selected} />
              {this.renderRelations(as.selected)}
              {this.renderCommentsOverlay(as.selected)}
            </>
          ) : null)}
        </div>
        {skeleton3d?.enabled && (
          <div className="main-view__skeleton-panel">
            <Skeleton3D store={this.props.store} config={skeleton3d} docked />
          </div>
        )}
      </div>
    );
  }

  _renderInfobar(as) {
    const { id, queue } = getRoot(as).task;

    return (
      <Space className={cn("main-view").elem("infobar").toClassName()} size="small">
        <span>Task #{id}</span>

        {queue && <span>{queue}</span>}
      </Space>
    );
  }

  renderAllAnnotations() {
    const as = this.props.store.annotationStore;
    const entities = [...as.annotations, ...as.predictions];

    if (isFF(FF_SIMPLE_INIT)) {
      // the same sorting we have in AnnotationsCarousel, so we'll see the same order in both places
      sortAnnotations(entities);
    }

    return <ViewAll store={as} annotations={entities} root={as.root} />;
  }

  renderRelations(selectedStore) {
    const store = selectedStore.relationStore;
    const taskData = this.props.store.task?.data;

    return (
      <RelationsOverlay
        key={selectedStore.id}
        store={store}
        ref={this.relationsRef}
        tags={selectedStore.names}
        taskData={taskData}
      />
    );
  }

  renderCommentsOverlay(selectedAnnotation) {
    const { store } = this.props;
    const { commentStore } = store;

    if (!store.hasInterface("annotations:comments") || !commentStore.isCommentable) return null;
    return <CommentsOverlay commentStore={commentStore} annotation={selectedAnnotation} />;
  }

  render() {
    const { store } = this.props;
    const as = store.annotationStore;
    const root = as.selected && as.selected.root;
    const { settings } = store;

    const skeletonEnabled = getEnv(store).skeleton3d?.enabled;
    // In 3D mode we keep the same App subtree mounted during task/frame
    // changes. In particular, do not replace it with a spinner when loading.
    if (!skeletonEnabled) {
      if (store.isLoading) return this.renderLoader();
      if (store.noTask) return this.renderNothingToLabel(store);
      if (store.noAccess) return this.renderNoAccess();
      if (store.labeledSuccess) return this.renderSuccess();
      if (!root) return this.renderNoAnnotation();
    }

    const viewingAll = as.viewingAll;
    const fallback = store.isLoading ? this.renderLoader()
      : store.noTask ? this.renderNothingToLabel(store)
      : store.noAccess ? this.renderNoAccess()
      : store.labeledSuccess ? this.renderSuccess()
      : !root ? this.renderNoAnnotation()
      : as.validation !== null ? this.renderConfigValidationException(store)
      : null;
    const mainContent = (
      <div
        className={cn("main-content")
          .mix(...(store.awaitingSuggestions ? ["requesting"] : []))
          .toClassName()}
      >
        {this._renderUI(as.selectedHistory?.root ?? root, as, fallback)}
      </div>
    );

    const isBulkMode = isFF(FF_BULK_ANNOTATION) && !isStarterCloudPlan() && store.hasInterface("annotation:bulk");
    return (
      <div
        className={cn("editor").mod({ fullscreen: settings.fullscreen }).toClassName()}
        ref={isFF(FF_LSDV_4620_3_ML) ? reactCleaner(this) : null}
      >
        <QueryClientProvider client={queryClient}>
          <Settings store={store} />
          <Provider store={store}>
            <ToastProvider>
              <InstructionsModal
                visible={store.showingDescription}
                onCancel={() => store.toggleDescription()}
                title={store.hasInterface("review") ? "Review Instructions" : "Labeling Instructions"}
              >
                {store.description}
              </InstructionsModal>

              {isDefined(store) && !store.isLoading && root && store.hasInterface("topbar") && <TopBar store={store} />}
              <div
                className={cn("wrapper")
                  .mod({
                    viewAll: viewingAll,
                    bsp: settings.effectiveBottomSidePanel,
                    showingBottomBar: true,
                  })
                  .toClassName()}
              >
                {isBulkMode || !store.hasInterface("side-column") || !as.selected ? (
                  <>
                    {mainContent}
                    {!store.isLoading && root && store.hasInterface("topbar") && <BottomBar store={store} />}
                  </>
                ) : (
                  <SideTabsPanels
                    panelsHidden={viewingAll}
                    currentEntity={as.selectedHistory ?? as.selected}
                    regions={as.selected.regionStore}
                    showComments={store.hasInterface("annotations:comments")}
                    showCustomTab={hasTagInSidebar(as.selected)}
                    focusTab={store.commentStore.tooltipMessage ? "comments" : null}
                  >
                    {mainContent}
                    {!store.isLoading && root && store.hasInterface("topbar") && <BottomBar store={store} />}
                  </SideTabsPanels>
                )}
              </div>
              <ToastViewport />
            </ToastProvider>
          </Provider>
          {store.hasInterface("debug") && <Debug store={store} />}
        </QueryClientProvider>
      </div>
    );
  }

  _notifyScroll = () => {
    if (this.relationsRef.current) {
      this.relationsRef.current.onResize();
    }
  };
}

export default observer(App);
