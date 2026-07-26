import KnowledgeBaseView from "../KnowledgeBaseView";
import { useAuth } from "../../auth/AuthContext";

/**
 * Admin-console entry point. The same management surface is also available to
 * technicians from the normal Knowledge Base destination; REST remains the
 * authorization boundary and readonly users never receive mutation controls.
 */
export default function KbArticlesPanel() {
  const { canWrite } = useAuth();
  return <KnowledgeBaseView canWrite={canWrite} initialManageMode={canWrite} />;
}
