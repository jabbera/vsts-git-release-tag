import * as tl from "vsts-task-lib/task";
import * as grc from "./GitRefCreator";

class GitTagCreator extends grc.GitRefCreator {
    readonly refName: string;

    constructor() {
        super();
        this.refName = this.generateRef(tl.getVariable("RELEASE_RELEASENAME"), "refs/tags/");
    }
}


async function run() {
    let creator: GitTagCreator = new GitTagCreator();
    await creator.run();
}

run();