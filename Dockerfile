# Ordo in a container: the same server `npm start` runs, with the repos it
# may open mounted under /workspace. See the README's "Running" section.
FROM node:22-slim
WORKDIR /app

# Dependencies first, so editing the source doesn't reinstall them. Plain
# `npm ci`, devDependencies included: `npm start` runs the server through tsx.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# HOST=0.0.0.0 only inside the container, so Docker can forward the port.
# Publish it on loopback (-p 127.0.0.1:5173:5173): Ordo has no auth.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5173 ORDO_WORKSPACE=/workspace
RUN mkdir -p /workspace
EXPOSE 5173
CMD ["npm", "start"]
