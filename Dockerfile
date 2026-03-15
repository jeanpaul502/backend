# Étape 1 : Build de l'application
FROM node:18-alpine AS builder

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances (y compris les devDependencies pour le build)
RUN npm install

# Copier le reste du code source
COPY . .

# Construire l'application NestJS
RUN npm run build

# Étape 2 : Production
FROM node:18-alpine

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer uniquement les dépendances de production
RUN npm install --only=production

# Copier les fichiers compilés depuis l'étape de build
COPY --from=builder /app/dist ./dist

# Exposer le port (sera redéfini par Dokploy si nécessaire, mais 3001 par défaut dans votre code)
EXPOSE 3001

# Définir la variable d'environnement pour la production
ENV NODE_ENV=production

# Commande de démarrage
CMD ["npm", "run", "start:prod"]
