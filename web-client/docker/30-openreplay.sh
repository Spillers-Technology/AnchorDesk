#!/bin/sh
# Overwrites the /openreplay.js placeholder with a live OpenReplay loader when
# OPENREPLAY_PROJECT_KEY is set. Runs from /docker-entrypoint.d at container
# start (stock nginx:alpine entrypoint). Without the key the placeholder stays
# and the image ships no analytics.
#
# Env:
#   OPENREPLAY_PROJECT_KEY   enables tracking (required)
#   OPENREPLAY_INGEST_POINT  self-hosted ingest URL (default: OpenReplay cloud)
#   OPENREPLAY_TRACKER_URL   tracker bundle URL (default: pinned CDN assist build)
#
# The generated JS must not contain shell-active characters beyond the three
# substituted variables (no other $, no backticks) — keep it that way.
set -eu
[ -n "${OPENREPLAY_PROJECT_KEY:-}" ] || exit 0
INGEST="${OPENREPLAY_INGEST_POINT:-https://api.openreplay.com/ingest}"
TRACKER="${OPENREPLAY_TRACKER_URL:-https://static.openreplay.com/18.0.17/openreplay-assist.js}"
cat > /usr/share/nginx/html/openreplay.js <<EOF
(function(){
  var initOpts={projectKey:"${OPENREPLAY_PROJECT_KEY}",ingestPoint:"${INGEST}",defaultInputMode:2,obscureTextNumbers:true,obscureTextEmails:true};
  var startOpts={userID:""};
  (function(A,s,a,y,e,r){r=window.OpenReplay=[e,r,y,[s-1,e]];s=document.createElement("script");s.src=A;s.async=!a;document.getElementsByTagName("head")[0].appendChild(s);r.start=function(){r.push([0])};r.stop=function(){r.push([1])};r.setUserID=function(id){r.push([2,id])};r.setUserAnonymousID=function(id){r.push([3,id])};r.setMetadata=function(k,v){r.push([4,k,v])};r.event=function(k,p,i){r.push([5,k,p,i])};r.issue=function(k,p){r.push([6,k,p])};r.isActive=function(){return false};r.getSessionToken=function(){};})("${TRACKER}",1,0,initOpts,startOpts);
  OpenReplay.start();
})();
EOF
