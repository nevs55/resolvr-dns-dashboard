<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { AppApiError } from "../../api/app"

const connection = useConnectionStore()

const managed = ref(false)
const nameInput = ref("")
const urlInput = ref("")
const tokenInput = ref("")
const formError = ref<string | null>(null)
const editingId = ref<number | null>(null)
const editName = ref("")
const editUrl = ref("")
const editToken = ref("")
const editError = ref<string | null>(null)

onMounted(async () => {
  await connection.loadEnvironments()
  managed.value = connection.managed
})

async function onAdd(): Promise<void> {
  formError.value = null
  try {
    await connection.createEnv(nameInput.value, urlInput.value, tokenInput.value)
    nameInput.value = ""
    urlInput.value = ""
    tokenInput.value = ""
  } catch (err) {
    formError.value = err instanceof AppApiError ? err.message : "Could not add the server."
  }
}

function startEdit(id: number, name: string, baseUrl: string): void {
  editingId.value = id
  editName.value = name
  editUrl.value = baseUrl
  editToken.value = ""
  editError.value = null
}

async function onSave(id: number): Promise<void> {
  editError.value = null
  try {
    await connection.updateEnv(id, {
      name: editName.value,
      baseUrl: editUrl.value,
      token: editToken.value !== "" ? editToken.value : undefined,
    })
    editingId.value = null
  } catch (err) {
    editError.value = err instanceof AppApiError ? err.message : "Could not save the server."
  }
}

async function onDelete(id: number): Promise<void> {
  if (!window.confirm("Remove this server? Its monitoring pages will stop working.")) return
  await connection.deleteEnv(id)
}
</script>

<template>
  <main class="max-w-2xl px-6 py-16">
    <h1 class="text-2xl font-semibold tracking-tight">Servers</h1>
    <p class="mt-1 text-sm text-gray-500">
      Manage the Technitium servers Resolvr monitors. Each one gets the full set of pages, plus its own switcher entry.
    </p>

    <div v-if="managed" id="connection-managed" class="mt-8 rounded-lg border border-border bg-background-card px-4 py-3.5 text-sm">
      This connection is set in the add-on's <b class="text-fg">Configuration</b> tab in Home Assistant, together with the API token.
      Change it there and restart the add-on.
    </div>

    <template v-else>
      <ul v-if="connection.environments.length" id="server-list" class="mt-8 flex flex-col gap-2">
        <li
          v-for="env in connection.environments"
          :key="env.id"
          :id="`env-${env.id}`"
          class="rounded-lg border border-border bg-background-card px-4 py-3"
        >
          <template v-if="editingId !== env.id">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold">{{ env.name }}</span>
              <span class="truncate font-mono text-xs text-gray-500">{{ env.baseUrl }}</span>
              <span class="ml-auto flex items-center gap-2">
                <button type="button" :id="`edit-env-${env.id}`" class="text-xs font-semibold text-accent" @click="startEdit(env.id, env.name, env.baseUrl)">Edit</button>
                <button type="button" :id="`delete-env-${env.id}`" class="text-xs font-semibold text-crit" @click="onDelete(env.id)">Delete</button>
              </span>
            </div>
          </template>
          <form v-else :id="`edit-form-${env.id}`" class="flex flex-col gap-2" @submit.prevent="onSave(env.id)">
            <input :id="`edit-name-${env.id}`" v-model="editName" class="w-full rounded-md border border-border bg-background-card px-3 py-1.5 text-sm" />
            <input :id="`edit-url-${env.id}`" v-model="editUrl" class="w-full rounded-md border border-border bg-background-card px-3 py-1.5 font-mono text-sm" />
            <input :id="`edit-token-${env.id}`" v-model="editToken" type="password" placeholder="API token (leave blank to keep)" class="w-full rounded-md border border-border bg-background-card px-3 py-1.5 font-mono text-sm" />
            <div class="flex items-center gap-2">
              <button type="submit" :id="`save-env-${env.id}`" class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Save</button>
              <button type="button" class="text-sm text-gray-500" @click="editingId = null">Cancel</button>
            </div>
            <p v-if="editError" class="text-sm text-crit">{{ editError }}</p>
          </form>
        </li>
      </ul>

      <form id="add-env-form" class="mt-6 flex flex-col gap-3 rounded-lg border border-border bg-background-card px-4 py-4" @submit.prevent="onAdd">
        <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Add a server</div>
        <input id="env-name" v-model="nameInput" placeholder="Name (e.g. Home)" class="w-full rounded-md border border-border bg-background-canvas px-3 py-2 text-sm" />
        <input id="env-url" v-model="urlInput" placeholder="http://10.0.60.60:5380" class="w-full rounded-md border border-border bg-background-canvas px-3 py-2 font-mono text-sm" />
        <input id="env-token" v-model="tokenInput" type="password" placeholder="Technitium API token" class="w-full rounded-md border border-border bg-background-canvas px-3 py-2 font-mono text-sm" />
        <div>
          <button id="add-env" type="submit" :disabled="connection.status === 'testing'" class="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50">Add server</button>
        </div>
        <p v-if="formError" id="connection-error" class="text-sm text-crit">{{ formError }}</p>
      </form>
    </template>
  </main>
</template>
