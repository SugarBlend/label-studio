/** Never send calibration observations or CSRF tokens to another origin. */
export async function requestReconstruction(input, sequence, signal) {
  const endpoint = new URL(input.config.endpoint, window.location.href);
  if (!input.config.endpoint || endpoint.origin !== window.location.origin ||
      !["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("A same-origin reconstruction endpoint is required.");
  }
  const token = document.querySelector('input[name="csrfmiddlewaretoken"]')?.value ||
    decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)?.[1] ?? "");
  const response = await fetch(endpoint.href, {
    method: "POST", credentials: "same-origin", redirect: "error", signal,
    headers: { "Content-Type": "application/json", "X-CSRFToken": token },
    body: JSON.stringify({ observations: input.observations, sequence }),
  });
  if (!response.ok) throw new Error(`Reconstruction failed (HTTP ${response.status}). Check calibration and permissions.`);
  const data = await response.json();
  if (data.sequence !== undefined && data.sequence !== sequence) throw new Error("Mismatched reconstruction sequence.");
  if (!Array.isArray(data.joints)) throw new Error("Invalid reconstruction response.");
  return { ...data, edges: input.edges };
}
