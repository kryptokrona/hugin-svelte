<script>
    import { onMount } from "svelte"
    import { upload, fileViewer } from '$lib/stores/files'
    import { fade } from "svelte/transition"
    import VideoPlayer from "$lib/components/chat/VideoPlayer.svelte"
    import Progress from "$lib/components/chat/Progress.svelte"
    export let file
    export let group = false
    export let rtc = false
    let uploadDone = false
    let uploading = false
    let image = ""
    let video = false
    let videoTypes = ['.mp4', '.webm', '.avi', '.mkv', '.mov','.wmv', '.mkv', '.mpeg']
    onMount( async () =>
    {   
        if (videoTypes.some(a => file.path.endsWith(a) && file.size < 50000000))
        {
            console.log('Found video format')
            video = true
            return
        }

        image = await loadFile(file)
    })

    $: {
        uploading = $upload.some(a => file.fileName === a.fileName && file.time === a.time)
        uploadDone = $upload.some(a => (uploading && a.progress === 100) || file.saved === true)
    }

    $: downloaders = $upload.filter(a => a.progress === 100 && file.fileName == a.fileName).length

    $: console.log("downloaders", downloaders)

    const focusImage = (image) => {
        $fileViewer.focusImage = file.path
        $fileViewer.enhanceImage = true
        $fileViewer.size = file.size
    }

    async function loadFile(file) {
        let arr = await window.api.loadFile(file.path, file.size)
        if (arr === "File" || arr === "File not found") {
            image = arr
            return
        }
        let blob = new Blob( [ arr ]);
        return URL.createObjectURL( blob );
    }


</script>

<div class="file" class:group in:fade="{{ duration: 150 }}">
    {#if !uploadDone && !uploading}
        <p in:fade class="message">{file.fileName} </p>
    {:else if uploading || file?.saved}
        <div in:fade>
            {#if !group}
            <Progress file={file} send={true}/>
            {/if}
        </div>
        {#if uploadDone || file?.saved}
            <p class="message done" in:fade>File uploaded!</p>
            <p in:fade class="message">{file.fileName} </p>
            <!-- {#if downloaders > 0} 
                <p class="count">{downloaders}</p>
            {/if} -->

            <!-- this counter can be cooler TODO  -->
            
        {:else}
        <p in:fade class="message sending blink_me">Uploading...</p>
        {/if}
    {/if}
    {#if image === "File"}
        <p>{file.fileName}</p>
    {:else if image === "File not found"}
        <p class="message error">File not found</p>
    {:else}
        {#if video}
            <VideoPlayer src={file}/>
        {:else}
        <div style="-webkit-user-drag: none;" on:click={focusImage}>
            <img
                in:fade="{{ duration: 150 }}"
                src="{image}"
                alt=""
            />
        </div>
        {/if}
    {/if}
</div>

<style lang="scss">

.file {
    background: none !important;
    max-width: 300px;
    img {
        max-width: 70%;
    }
}

.sending {
    color: var(--alert-color) !important;
    font-size: 12px;
}

.message {
        margin: 0;
        word-break: break-word;
        font-family: 'Montserrat', sans-serif;
        font-weight: 400;
        color: var(--text-color);
        font-size: 15px;
        user-select: all;
        margin-bottom: 5px;
}

.count {
    font-family: "Montserrat";
    font-size: 12px;
    font-weight: 800;
    display: flex;
    color: black;
    background: magenta;
    width: 15px;
    justify-content: center;
    background: #f9f8f8;
    border-radius: 15%;
    margin-top: 5px;
}

    
.done {
    color: var(--success-color) !important;
}

.error {
    color: var(--warn-color) !important; 
}

.group {
    margin-left: 30px;
}


</style>