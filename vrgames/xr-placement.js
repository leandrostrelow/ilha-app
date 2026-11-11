// Align the physical headset pose (in local-floor space) with a virtual
// destination. Use the XR frame pose, never an ArrayCamera's stale matrixWorld.
export function alignPlayer(head,headYaw,destination,heading){
 const yaw=heading-headYaw,c=Math.cos(yaw),s=Math.sin(yaw);
 return {yaw,x:destination.x-(c*head.x+s*head.z),z:destination.z-(-s*head.x+c*head.z)};
}
