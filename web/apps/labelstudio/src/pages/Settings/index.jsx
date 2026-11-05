import { Redirect, useParams } from "react-router-dom";
import { useIsOrgAdmin } from "../../hooks/useIsOrgAdmin";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { WebhookPage } from "../WebhookPage/WebhookPage";
import { AccessSettings, useAccessSettingsMenuItem } from "./AccessSettings";
import { DangerZone } from "./DangerZone";
import { GeneralSettings } from "./GeneralSettings";
import { AnnotationSettings } from "./AnnotationSettings";
import { LabelingSettings } from "./LabelingSettings";
import { MachineLearningSettings } from "./MachineLearningSettings/MachineLearningSettings";
import { PredictionsSettings } from "./PredictionsSettings/PredictionsSettings";
import { StorageSettings } from "./StorageSettings/StorageSettings";
import { Skeleton3DSettings } from "./Skeleton3DSettings";
import "./settings.scss";

export const MenuLayout = ({ children, ...routeProps }) => {
  // project access control: the Access page is shown to organization admins only
  const accessSettings = useAccessSettingsMenuItem();
  const { canManageProjectSettings, isLoading } = useIsOrgAdmin();
  const { id } = useParams();
  if (isLoading) return <div role="status" className="p-6">Checking project settings permissions…</div>;
  if (!canManageProjectSettings) return <Redirect to={`/projects/${id}/data`} />;

  return (
    <SidebarMenu
      menuItems={[
        GeneralSettings,
        LabelingSettings,
        Skeleton3DSettings,
        AnnotationSettings,
        MachineLearningSettings,
        PredictionsSettings,
        StorageSettings,
        WebhookPage,
        accessSettings,
        DangerZone,
      ].filter(Boolean)}
      path={routeProps.match.url}
      children={children}
    />
  );
};

const pages = {
  AnnotationSettings,
  LabelingSettings,
  Skeleton3DSettings,
  MachineLearningSettings,
  PredictionsSettings,
  StorageSettings,
  WebhookPage,
  AccessSettings,
  DangerZone,
};

export const SettingsPage = {
  title: "Settings",
  path: "/settings",
  exact: true,
  layout: MenuLayout,
  component: GeneralSettings,
  pages,
};
