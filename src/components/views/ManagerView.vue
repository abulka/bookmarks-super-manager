<script setup lang="ts">
import TreeSidebar from '../manager/TreeSidebar.vue'
import ContentList from '../manager/ContentList.vue'
import Breadcrumbs from '../manager/Breadcrumbs.vue'

defineProps<{ docId: string }>()
</script>

<template>
  <div class="manager">
    <TreeSidebar :doc-id="docId" />
    <div class="manager-main">
      <Breadcrumbs :doc-id="docId" />
      <ContentList :doc-id="docId" />
    </div>
  </div>
</template>

<style scoped>
.manager {
  display: flex;
  flex: 1;
  min-height: 0;
}
.manager-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
</style>