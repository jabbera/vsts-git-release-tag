import * as tl from "azure-pipelines-task-lib/task";
import * as grc from "./GitRefCreator";

class GitTagCreator extends grc.GitRefCreator {
    readonly refName: string;

    constructor() {
        super();
        this.refName = this.generateRef(tl.getVariable("RELEASE_RELEASENAME"), "tags/");
        if (this.refName == null) {
            this.refName = this.generateRef(tl.getVariable('build.buildNumber'), "tags/");
        }
    }
}


async function run() {
    let creator: GitTagCreator = new GitTagCreator();
    await creator.run();
}

run();