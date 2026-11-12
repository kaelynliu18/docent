/** pnpm vapid — print a VAPID key pair for web push. Put both in your env; never commit the private key. */
import * as webpush from "web-push";

const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
